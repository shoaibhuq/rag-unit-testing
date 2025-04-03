import * as vscode from "vscode";
import weaviate, { WeaviateClient, ObjectsBatcher } from "weaviate-ts-client";
import { createHash } from "crypto";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load environment variables
dotenv.config();

// Define the class schema for C function content
const functionSchema = {
  class: "CFunction",
  properties: [
    {
      name: "functionName",
      dataType: ["string"],
      description: "The name of the C function",
    },
    {
      name: "content",
      dataType: ["text"],
      description: "The content/body of the C function",
    },
    {
      name: "parameters",
      dataType: ["string[]"],
      description: "The parameters of the C function",
    },
    {
      name: "returnType",
      dataType: ["string"],
      description: "The return type of the C function",
    },
    {
      name: "filePath",
      dataType: ["string"],
      description: "The file path where the function is defined",
    },
  ],
  vectorizer: "text2vec-openai",
};

// Helper function to parse C functions
function parseCFunctions(fileContent: string): Array<{
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
}> {
  const functions: Array<{
    functionName: string;
    content: string;
    parameters: string[];
    returnType: string;
  }> = [];

  // Remove comments first
  const contentWithoutComments = fileContent
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
    .replace(/\/\/.*$/gm, ""); // Remove single-line comments

  // Process each line to find function declarations and their bodies
  let inFunction = false;
  let braceCount = 0;
  let currentFunction = "";
  let currentFunctionName = "";
  let currentReturnType = "";
  let currentParams: string[] = [];

  // Split by lines for easier processing
  const lines = contentWithoutComments.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip preprocessor directives, typedefs, structs, enums, and empty lines
    if (
      line.startsWith("#") ||
      line.startsWith("typedef") ||
      (line.startsWith("struct ") && !line.includes("(")) ||
      line.startsWith("enum ") ||
      line === ""
    ) {
      continue;
    }

    // If we're not in a function, look for function declarations
    if (!inFunction) {
      // Look for potential function declarations
      // Pattern: [return_type] [function_name]([params]) {
      const functionDeclMatch = line.match(
        /^(\w+(?:\s+\w+)*)\s+(\w+)\s*\(([^)]*)\)\s*({)?/
      );

      if (functionDeclMatch) {
        const possibleReturnType = functionDeclMatch[1].trim();
        const possibleFunctionName = functionDeclMatch[2].trim();
        const possibleParams = functionDeclMatch[3].trim();

        // Skip main function and function prototypes (no opening brace)
        if (
          possibleFunctionName === "main" ||
          (!functionDeclMatch[4] && !line.endsWith("{"))
        ) {
          continue;
        }

        // Skip if this is a variable declaration with initialization
        if (possibleParams === "" && line.includes("=")) {
          continue;
        }

        // This is likely a function declaration
        inFunction = true;
        currentFunctionName = possibleFunctionName;
        currentReturnType = possibleReturnType;
        currentParams = possibleParams
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p !== "");
        currentFunction = line;

        // Count opening braces
        braceCount = (line.match(/{/g) || []).length;

        // Check if there are closing braces in the same line
        braceCount -= (line.match(/}/g) || []).length;

        // If braces balance out on the same line, this was a one-line function
        if (braceCount === 0 && line.includes("{") && line.includes("}")) {
          functions.push({
            functionName: currentFunctionName,
            content: currentFunction,
            parameters: currentParams,
            returnType: currentReturnType,
          });
          inFunction = false;
          currentFunction = "";
        }
      }
    } else {
      // We're inside a function, add this line to the current function
      currentFunction += "\n" + line;

      // Count braces to find the end of the function
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;

      // If braces balance out, we've reached the end of the function
      if (braceCount === 0) {
        functions.push({
          functionName: currentFunctionName,
          content: currentFunction,
          parameters: currentParams,
          returnType: currentReturnType,
        });
        inFunction = false;
        currentFunction = "";
      }
    }
  }

  return functions;
}

export class VectorDBManager {
  private client: WeaviateClient;
  private openai: OpenAI;
  private isInitialized: boolean = false;

  constructor() {
    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Weaviate client
    this.client = weaviate.client({
      scheme: process.env.WEAVIATE_SCHEME || "https",
      host: process.env.WEAVIATE_HOST || "",
      apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY || ""),
      headers: {
        "X-OpenAI-Api-Key": process.env.OPENAI_API_KEY || "",
      },
    });
  }

  public async initialize(): Promise<boolean> {
    try {
      // Check if the schema exists, if not create it
      const schemaRes = await this.client.schema.getter().do();

      const classExists = schemaRes.classes?.some(
        (c: any) => c.class === functionSchema.class
      );

      if (!classExists) {
        await this.client.schema.classCreator().withClass(functionSchema).do();
        console.log(`Created schema: ${functionSchema.class}`);
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error("Failed to initialize Weaviate:", error);
      vscode.window.showErrorMessage(
        "Failed to initialize Weaviate. Please check your configuration."
      );
      return false;
    }
  }

  public async storeFileContext(
    filePath: string,
    fileContent: string
  ): Promise<void> {
    if (!this.isInitialized) {
      const initialized = await this.initialize();
      if (!initialized) return;
    }

    try {
      // Parse the C functions from the file
      const functions = parseCFunctions(fileContent);

      if (functions.length === 0) {
        vscode.window.showInformationMessage("No functions found in the file.");
        return;
      }

      console.log(`Found ${functions.length} functions to store in Weaviate:`);
      functions.forEach((func) => {
        console.log(
          ` - ${func.returnType} ${func.functionName}(${func.parameters.join(
            ", "
          )})`
        );
      });

      const batcher = this.client.batch.objectsBatcher();

      // Add each function to the batch
      for (const func of functions) {
        const id = createHash("md5")
          .update(`${filePath}_${func.functionName}`)
          .digest("hex");

        batcher.withObject({
          class: functionSchema.class,
          id,
          properties: {
            functionName: func.functionName,
            content: func.content,
            parameters: func.parameters,
            returnType: func.returnType,
            filePath,
          },
        });
      }

      // Execute the batch operation
      await batcher.do();

      // Print vector embeddings for debugging
      await this.debugPrintVectors(functions);

      vscode.window.showInformationMessage(
        `Successfully stored ${functions.length} functions in Weaviate.`
      );
    } catch (error) {
      console.error("Error storing file context:", error);
      vscode.window.showErrorMessage(
        "Failed to store file context in Weaviate."
      );
    }
  }

  public async searchSimilarFunctions(
    functionName: string,
    limit: number = 5
  ): Promise<any[]> {
    if (!this.isInitialized) {
      const initialized = await this.initialize();
      if (!initialized) return [];
    }

    try {
      // Search for similar functions by name
      const result = await this.client.graphql
        .get()
        .withClassName(functionSchema.class)
        .withFields("functionName content parameters returnType filePath")
        .withNearText({ concepts: [functionName] })
        .withLimit(limit)
        .do();

      return result.data.Get[functionSchema.class] || [];
    } catch (error) {
      console.error("Error searching similar functions:", error);
      vscode.window.showErrorMessage(
        "Failed to search for similar functions in Weaviate."
      );
      return [];
    }
  }

  /**
   * Fetches and prints the vector embeddings for a specific function
   * @param functionId The ID of the function to fetch embeddings for
   */
  public async printVectorEmbedding(functionId: string): Promise<void> {
    if (!this.isInitialized) {
      const initialized = await this.initialize();
      if (!initialized) return;
    }

    try {
      // Fetch the object with its vector
      const result = await this.client.data
        .getterById()
        .withClassName(functionSchema.class)
        .withId(functionId)
        .withVector()
        .do();

      // Check if the object exists and has a vector
      if (result && result.vector) {
        console.log("=== Vector Embedding for function ===");
        console.log(`Function ID: ${functionId}`);
        console.log(
          `Function Name: ${result.properties?.functionName || "Unknown"}`
        );
        console.log("Vector (first 10 dimensions):");

        // Print first 10 dimensions for readability
        const vector = result.vector;
        const vectorPreview = vector.slice(0, 10);
        console.log(vectorPreview);
        console.log(`Vector Length: ${vector.length} dimensions`);

        // Print some basic vector stats
        const sum = vector.reduce((acc, val) => acc + val, 0);
        const mean = sum / vector.length;
        const min = Math.min(...vector);
        const max = Math.max(...vector);
        console.log(
          `Vector Stats - Mean: ${mean.toFixed(4)}, Min: ${min.toFixed(
            4
          )}, Max: ${max.toFixed(4)}`
        );
        console.log("=====================================");
      } else {
        console.log(`No vector found for function with ID: ${functionId}`);
      }
    } catch (error) {
      console.error("Error fetching vector embedding:", error);
    }
  }

  /**
   * Prints vector embeddings for all functions that match a specific name
   * @param functionName The name of the functions to fetch embeddings for
   */
  public async printVectorEmbeddingsForFunctions(
    functionName: string
  ): Promise<void> {
    if (!this.isInitialized) {
      const initialized = await this.initialize();
      if (!initialized) return;
    }

    try {
      // Search for functions with this name
      const result = await this.client.graphql
        .get()
        .withClassName(functionSchema.class)
        .withFields("functionName _additional { id vector }")
        .withWhere({
          path: ["functionName"],
          operator: "Equal",
          valueString: functionName,
        })
        .do();

      const functions = result.data.Get[functionSchema.class] || [];

      if (functions.length === 0) {
        console.log(`No functions found with name: ${functionName}`);
        return;
      }

      console.log(
        `=== Vector Embeddings for ${functions.length} functions with name '${functionName}' ===`
      );

      for (const func of functions) {
        if (func._additional?.id && func._additional?.vector) {
          console.log(`\nFunction ID: ${func._additional.id}`);
          console.log("Vector (first 10 dimensions):");

          const vectorPreview = func._additional.vector.slice(0, 10);
          console.log(vectorPreview);
          console.log(
            `Vector Length: ${func._additional.vector.length} dimensions`
          );

          // Print some basic stats about the vector
          const vector = func._additional.vector;
          const sum = vector.reduce((acc: number, val: number) => acc + val, 0);
          const mean = sum / vector.length;
          const min = Math.min(...vector);
          const max = Math.max(...vector);
          console.log(
            `Vector Stats - Mean: ${mean.toFixed(4)}, Min: ${min.toFixed(
              4
            )}, Max: ${max.toFixed(4)}`
          );
        } else {
          console.log(`\nNo vector found for function: ${func.functionName}`);
        }
      }

      console.log("\n=================================================");
    } catch (error) {
      console.error("Error fetching vector embeddings for functions:", error);
    }
  }

  /**
   * Called during function storage to print out the vectors for debugging
   */
  private async debugPrintVectors(
    functions: Array<{
      functionName: string;
      content: string;
      parameters: string[];
      returnType: string;
    }>
  ): Promise<void> {
    if (functions.length === 0) return;

    // Give Weaviate a moment to process the vectors
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("\n=== DEBUG: Vector Embeddings for Stored Functions ===");

    for (const func of functions) {
      // Generate the same ID we used when storing the function
      const functionId = createHash("md5")
        .update(`${func.functionName}`)
        .digest("hex");

      try {
        await this.printVectorEmbedding(functionId);
      } catch (error) {
        console.error(
          `Failed to print vector for ${func.functionName}:`,
          error
        );
      }
    }
  }
}
