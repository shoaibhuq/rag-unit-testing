// Import necessary modules
import * as vscode from "vscode";
import weaviate, {
  WeaviateClient,
  ObjectsBatcher,
  ApiKey,
} from "weaviate-ts-client"; // Corrected import for ApiKey
import { createHash } from "crypto";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as path from "path"; // Import path module at the top
import * as fs from "fs";
import fetch from "node-fetch"; // Add node-fetch import

// Fix for 'realFetch.call is not a function' error
// @ts-ignore
global.fetch = fetch;

// Load environment variables with absolute path
const workspaceRoot =
  vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
const envPath = path.join(workspaceRoot, ".env");

// Check if .env file exists and load it
if (fs.existsSync(envPath)) {
  console.log(`Loading environment variables from: ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.warn(`No .env file found at: ${envPath}`);
}

// Define interface for function data
interface FunctionData {
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
  filePath?: string;
  _additional?: {
    id?: string;
    distance?: number;
    vector?: number[];
  };
}

// Interface for parsed function data
interface ParsedFunction {
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
}

// Define the class schema for C function content
// NOTE: Ensure this schema matches exactly what's in your Weaviate instance
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
  vectorizer: "text2vec-openai", // Assumes OpenAI vectorization module is enabled in Weaviate
  moduleConfig: {
    // Make sure this matches your Weaviate setup
    "text2vec-openai": {
      model: "ada", // Or specify your desired model
      type: "text",
    },
  },
};

/**
 * Parses C functions from file content using regular expressions.
 * NOTE: This parser is basic and might struggle with complex C code,
 * macros, nested comments, or unusual formatting.
 * Consider using a more robust parser like tree-sitter for production use.
 * @param fileContent - The string content of the C file.
 * @returns An array of parsed function objects.
 */
function parseCFunctions(fileContent: string): Array<ParsedFunction> {
  const functions: Array<ParsedFunction> = [];

  // Remove comments first to simplify parsing
  const contentWithoutComments = fileContent
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments /* ... */
    .replace(/\/\/.*$/gm, ""); // Remove single-line comments // ...

  // Improved regex to capture function definitions
  // This handles various code styles better, including functions that span multiple lines
  const functionRegex =
    /^([\w\s\*]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:;|\{([\s\S]*?)(?:^|\n)\s*\})/gm;
  // Explanation:
  // ^                  - Start of a line (due to 'm' flag)
  // ([\w\s\*]+?)      - Capture group 1: Return type (words, whitespace, pointers *, non-greedy)
  // \s+                - One or more spaces
  // (\w+)              - Capture group 2: Function name (word characters)
  // \s*\(              - Optional space, opening parenthesis
  // ([^)]*)            - Capture group 3: Parameters (anything not a closing parenthesis)
  // \)\s*              - Closing parenthesis, optional space
  // (?:;|\{([\s\S]*?)  - Non-capturing group: Either ; (for declarations) or { followed by content
  // (?:^|\n)\s*\})     - End with } either at start of line or after newline with optional whitespace

  let match;
  while ((match = functionRegex.exec(contentWithoutComments)) !== null) {
    // Improved filtering to avoid matching struct initializations or other constructs
    if (
      match[1].includes(";") ||
      match[1].trim().startsWith("struct") ||
      match[1].trim().startsWith("enum") ||
      match[1].trim().startsWith("typedef") ||
      match[1].trim().startsWith("#") ||
      !match[4] // Skip function declarations (no body)
    ) {
      continue;
    }

    const returnType = match[1].trim().replace(/\s+/g, " "); // Normalize whitespace in return type
    const functionName = match[2].trim();
    const paramsString = match[3].trim();
    const content = match[0]; // Full match including signature and body

    // Skip main function
    if (functionName === "main") {
      continue;
    }

    const parameters = paramsString
      ? paramsString
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p !== "void" && p !== "") // Handle 'void' and empty params
      : [];

    functions.push({
      functionName,
      content,
      parameters,
      returnType,
    });
  }

  console.log(`Parser found ${functions.length} functions.`);
  return functions;
}

export class VectorDBManager {
  private client: WeaviateClient;
  private openai: OpenAI; // Keep OpenAI client if needed elsewhere, though vectorization is handled by Weaviate module
  private isInitialized: boolean = false;

  constructor() {
    // Try to get credentials from VS Code settings first
    const config = vscode.workspace.getConfiguration("rag-unit-testing");

    // Get keys from VS Code settings if available, otherwise use .env
    const openaiApiKey =
      (config.get("openaiApiKey") as string) || process.env.OPENAI_API_KEY;
    const weaviateHost =
      (config.get("weaviateHost") as string) || process.env.WEAVIATE_HOST;
    const weaviateApiKey =
      (config.get("weaviateApiKey") as string) || process.env.WEAVIATE_API_KEY;
    const weaviateScheme =
      (config.get("weaviateScheme") as string) ||
      process.env.WEAVIATE_SCHEME ||
      "https"; // Default to https

    // More detailed debug output for credential sources and values
    console.log("Credentials configuration:");
    console.log(
      `- OPENAI_API_KEY source: ${
        config.get("openaiApiKey") ? "VS Code settings" : "Environment variable"
      }`
    );
    console.log(
      `- WEAVIATE_HOST source: ${
        config.get("weaviateHost") ? "VS Code settings" : "Environment variable"
      }`
    );
    console.log(
      `- WEAVIATE_API_KEY source: ${
        config.get("weaviateApiKey")
          ? "VS Code settings"
          : "Environment variable"
      }`
    );
    console.log(
      `- WEAVIATE_SCHEME source: ${
        config.get("weaviateScheme")
          ? "VS Code settings"
          : "Environment variable or default"
      }`
    );

    // Debug output for environment variables (with partial redaction for security)
    console.log("Credential values loaded:");
    console.log(
      `- OPENAI_API_KEY: ${
        openaiApiKey
          ? `✓ (set, length: ${
              openaiApiKey.length
            }, starts with: ${openaiApiKey.substring(0, 10)}...)`
          : "✗ (missing)"
      }`
    );
    console.log(
      `- WEAVIATE_HOST: ${weaviateHost ? weaviateHost : "✗ (missing)"}`
    );
    console.log(
      `- WEAVIATE_API_KEY: ${
        weaviateApiKey
          ? `✓ (set, length: ${
              weaviateApiKey.length
            }, starts with: ${weaviateApiKey.substring(0, 5)}...)`
          : "✗ (missing)"
      }`
    );
    console.log(`- WEAVIATE_SCHEME: ${weaviateScheme}`);

    // Check for characters in the API keys that might cause parsing issues
    if (openaiApiKey) {
      const hasSpecialChars = /[\r\n\t%]/.test(openaiApiKey);
      console.log(
        `- OPENAI_API_KEY contains special characters: ${hasSpecialChars}`
      );
    }

    if (weaviateApiKey) {
      const hasSpecialChars = /[\r\n\t%]/.test(weaviateApiKey);
      console.log(
        `- WEAVIATE_API_KEY contains special characters: ${hasSpecialChars}`
      );
    }

    if (!openaiApiKey || !weaviateHost || !weaviateApiKey) {
      const missingVars = [
        !openaiApiKey ? "OPENAI_API_KEY" : null,
        !weaviateHost ? "WEAVIATE_HOST" : null,
        !weaviateApiKey ? "WEAVIATE_API_KEY" : null,
      ]
        .filter(Boolean)
        .join(", ");

      // Show a more helpful error message that includes how to set the configuration
      const errorMsg = `Missing required credentials: ${missingVars}. Please set them in either:
      1. VS Code settings (File > Preferences > Settings > Extensions > RAG Unit Testing)
      2. .env file in your workspace root`;

      vscode.window
        .showErrorMessage(errorMsg, "Open Settings")
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "rag-unit-testing"
            );
          }
        });

      throw new Error(
        `Missing credentials for VectorDBManager: ${missingVars}`
      );
    }

    // Initialize OpenAI client (might be needed for direct LLM calls later)
    this.openai = new OpenAI({ apiKey: openaiApiKey });

    // Initialize Weaviate client
    try {
      this.client = weaviate.client({
        scheme: weaviateScheme as "http" | "https", // Cast to expected type
        host: weaviateHost,
        apiKey: new ApiKey(weaviateApiKey), // Use ApiKey class
        headers: {
          "X-OpenAI-Api-Key": openaiApiKey, // Pass OpenAI key for vectorization module
        },
      });
    } catch (error: any) {
      console.error("Failed to create Weaviate client:", error);
      vscode.window.showErrorMessage(
        `Failed to create Weaviate client: ${error.message || error}`
      );
      throw error; // Re-throw to prevent using an uninitialized client
    }
  }

  /**
   * Initializes the Weaviate schema if it doesn't exist.
   * @returns {Promise<boolean>} True if initialized successfully or already initialized, false otherwise.
   */
  public async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      // Set timeout for connection
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error("Connection to Weaviate timed out after 10 seconds")
            ),
          10000
        );
      });

      console.log("Attempting to connect to Weaviate...");

      // Check connection with timeout
      const connectionPromise = this.client.misc.metaGetter().do();
      const meta = await Promise.race([connectionPromise, timeoutPromise]);

      console.log("Weaviate connection successful:", meta?.version);

      // Check if schema exists
      const schemaRes = await this.client.schema.getter().do();

      // Type check the response
      if (!schemaRes || !Array.isArray(schemaRes.classes)) {
        console.error("Invalid schema response from Weaviate:", schemaRes);
        throw new Error("Invalid schema response from Weaviate");
      }

      const classExists = schemaRes.classes.some(
        (c: any) => c.class === functionSchema.class
      );

      if (!classExists) {
        console.log(`Schema '${functionSchema.class}' not found. Creating...`);
        try {
          await this.client.schema
            .classCreator()
            .withClass(functionSchema)
            .do();
          console.log(`Created schema: ${functionSchema.class}`);
        } catch (schemaError: any) {
          throw new Error(
            `Failed to create schema: ${schemaError.message || "Unknown error"}`
          );
        }
      } else {
        console.log(`Schema '${functionSchema.class}' already exists.`);
      }

      this.isInitialized = true;
      console.log("VectorDBManager initialized successfully.");
      return true;
    } catch (error: any) {
      this.isInitialized = false;

      // Provide more specific error message based on error type
      let errorMessage = "Failed to initialize Weaviate: ";

      if (error.message && error.message.includes("timed out")) {
        errorMessage +=
          "Connection timed out. Check if Weaviate server is running.";
      } else if (
        error.name === "FetchError" ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("fetch") ||
        error.message?.includes("call")
      ) {
        errorMessage += `${error.message}. This is likely a network or compatibility issue with the Weaviate client.`;
      } else if (error.statusCode === 401 || error.statusCode === 403) {
        errorMessage += "Authentication failed. Check your API keys.";
      } else {
        errorMessage += error.message || String(error);
      }

      console.error(errorMessage);
      vscode.window.showErrorMessage(errorMessage);

      return false;
    }
  }

  /**
   * Parses functions from file content and stores them in Weaviate.
   * Uses a batch operation for efficiency.
   * @param filePath - The absolute path of the file being processed.
   * @param fileContent - The text content of the file.
   */
  public async storeFileContext(
    filePath: string,
    fileContent: string
  ): Promise<void> {
    if (!this.isInitialized) {
      console.log("Initializing VectorDBManager before storing context...");
      const initialized = await this.initialize();
      if (!initialized) {
        vscode.window.showErrorMessage(
          "Cannot store file context: Vector DB initialization failed."
        );
        return;
      }
    }

    try {
      // Parse the C functions from the file content
      const functions = parseCFunctions(fileContent);

      if (functions.length === 0) {
        console.log("No functions found by parser in:", filePath);
        // Optionally inform the user, or just log it.
        vscode.window.showInformationMessage(
          "No functions found to store from this file."
        );
        return;
      }

      console.log(
        `Found ${functions.length} functions in ${filePath} to store/update in Weaviate:`
      );
      functions.forEach((func) => console.log(` - ${func.functionName}`));

      const batcher: ObjectsBatcher = this.client.batch.objectsBatcher();
      let objectsAdded = 0;

      // Add each function to the batch
      for (const func of functions) {
        // Generate a consistent ID based on file path and function name
        const objectId = createHash("sha256")
          .update(`${filePath}::${func.functionName}`)
          .digest("hex");

        batcher.withObject({
          class: functionSchema.class,
          id: objectId,
          properties: {
            functionName: func.functionName,
            content: func.content,
            parameters: func.parameters,
            returnType: func.returnType,
            filePath: filePath,
          },
        });
        objectsAdded++;
      }

      // Execute the batch operation if objects were added
      if (objectsAdded > 0) {
        console.log(
          `Sending batch with ${objectsAdded} objects to Weaviate...`
        );
        const batchResult = await batcher.do();

        // Enhanced error handling for batch operations
        if (!batchResult || !Array.isArray(batchResult)) {
          throw new Error("Invalid batch result returned from Weaviate");
        }

        // Track successful and failed operations
        let successCount = 0;
        let errorCount = 0;
        const errorDetails: string[] = [];

        // Process each result
        batchResult.forEach((item, index) => {
          // Check for errors with proper type checking
          const errors = item.result?.errors;
          if (errors && Array.isArray(errors) && errors.length > 0) {
            errorCount++;
            const funcName =
              index < functions.length
                ? functions[index].functionName
                : "unknown";
            // Safely access error message
            const errorMessage =
              errors[0] && typeof errors[0].message === "string"
                ? errors[0].message
                : "Unknown error";

            errorDetails.push(`${funcName}: ${errorMessage}`);
            console.error(`Error storing function ${funcName}:`, errors);
          } else {
            successCount++;
          }
        });

        // Report results to user
        if (errorCount > 0) {
          const errorMsg =
            errorDetails.length <= 3
              ? errorDetails.join("; ")
              : `${errorDetails.slice(0, 3).join("; ")}... and ${
                  errorCount - 3
                } more errors`;

          vscode.window.showWarningMessage(
            `Stored ${successCount}/${objectsAdded} functions. ${errorCount} errors occurred: ${errorMsg}`
          );
        } else {
          vscode.window.showInformationMessage(
            `Successfully stored ${objectsAdded} functions from ${path.basename(
              filePath
            )}.`
          );
        }
      } else {
        console.log("No new function objects to add to the batch.");
        vscode.window.showInformationMessage(
          "No functions were stored (either none found or already up to date)."
        );
      }
    } catch (error: any) {
      console.error("Error storing file context in Weaviate:", error);

      // Provide more specific error messages based on error type
      let errorMessage = "Failed to store file context: ";
      if (
        error.name === "FetchError" ||
        error.message?.includes("ECONNREFUSED")
      ) {
        errorMessage +=
          "Cannot connect to Weaviate server. Check if it's running.";
      } else if (error.statusCode === 401 || error.statusCode === 403) {
        errorMessage += "Authentication failed. Check your API keys.";
      } else {
        errorMessage += error.message || String(error);
      }

      vscode.window.showErrorMessage(errorMessage);
    }
  }

  /**
   * Searches for functions in Weaviate that are semantically similar to the provided text
   * (e.g., function name or description).
   * @param queryText - The text to search for similar functions.
   * @param limit - The maximum number of similar functions to return. Default is 5.
   * @returns A promise that resolves to an array of similar function objects or an empty array if none are found or an error occurs.
   */
  public async searchSimilarFunctions(
    queryText: string,
    limit: number = 5
  ): Promise<FunctionData[]> {
    if (!this.isInitialized) {
      console.warn("Attempted search before VectorDBManager was initialized.");
      const initialized = await this.initialize();
      if (!initialized) {
        console.error("Failed to initialize VectorDBManager for search.");
        return [];
      }
    }

    try {
      console.log(`Searching for functions similar to: "${queryText}"`);

      // Define the expected return type structure for better type safety
      interface SearchResult {
        data?: {
          Get?: {
            [key: string]: FunctionData[];
          };
        };
      }

      const result = (await this.client.graphql
        .get()
        .withClassName(functionSchema.class)
        .withFields(
          "functionName content parameters returnType filePath _additional { id distance }"
        )
        .withNearText({ concepts: [queryText] })
        .withLimit(limit)
        .do()) as SearchResult;

      // Safely access nested properties with optional chaining
      const className = functionSchema.class;
      const similarFunctions = result?.data?.Get?.[className] || [];

      console.log(`Found ${similarFunctions.length} similar functions.`);

      // Log found functions and their distances for debugging
      similarFunctions.forEach((f) => {
        const distance =
          f._additional?.distance !== undefined
            ? f._additional.distance.toFixed(4)
            : "N/A";
        console.log(` - ${f.functionName} (Distance: ${distance})`);
      });

      return similarFunctions;
    } catch (error: any) {
      console.error("Error searching similar functions in Weaviate:", error);
      vscode.window.showErrorMessage(
        `Failed to search for similar functions: ${error.message || error}`
      );
      return [];
    }
  }

  /**
   * Fetches a specific function object by its Weaviate ID.
   * @param functionObjectId The Weaviate UUID or custom ID of the function object.
   * @returns The function object or null if not found or an error occurs.
   */
  public async getFunctionById(
    functionObjectId: string
  ): Promise<FunctionData | null> {
    if (!this.isInitialized) {
      console.warn(
        "Attempted getFunctionById before VectorDBManager was initialized."
      );
      return null;
    }
    try {
      const result = await this.client.data
        .getterById()
        .withClassName(functionSchema.class)
        .withId(functionObjectId)
        .do();

      if (result && result.properties) {
        // Convert to FunctionData format with proper type checking
        const props = result.properties;
        return {
          functionName:
            typeof props.functionName === "string" ? props.functionName : "",
          content: typeof props.content === "string" ? props.content : "",
          parameters: Array.isArray(props.parameters) ? props.parameters : [],
          returnType:
            typeof props.returnType === "string" ? props.returnType : "",
          filePath:
            typeof props.filePath === "string" ? props.filePath : undefined,
          _additional: {
            id: functionObjectId,
          },
        };
      }
      return null;
    } catch (error: any) {
      // Weaviate throws if ID doesn't exist, handle gracefully
      if (error.message && error.message.includes("404")) {
        console.log(`Function with ID ${functionObjectId} not found.`);
      } else {
        console.error(
          `Error fetching function by ID ${functionObjectId}:`,
          error
        );
        vscode.window.showErrorMessage(
          `Failed to fetch function details: ${error.message || error}`
        );
      }
      return null;
    }
  }

  // --- Debugging Functions ---

  /**
   * Fetches and prints the vector embedding for a specific function object ID.
   * @param functionObjectId The Weaviate ID of the function object.
   */
  public async printVectorEmbedding(functionObjectId: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
      if (!this.isInitialized) return;
    }

    try {
      const result = await this.client.data
        .getterById()
        .withClassName(functionSchema.class)
        .withId(functionObjectId)
        .withVector() // Explicitly request the vector
        .do();

      if (result && result.vector) {
        console.log(
          `\n=== Vector Embedding for Object ID: ${functionObjectId} ===`
        );
        console.log(
          ` Function Name: ${result.properties?.functionName || "N/A"}`
        );
        console.log(` File Path: ${result.properties?.filePath || "N/A"}`);
        const vector = result.vector as number[]; // Type assertion
        console.log(
          ` Vector (first 10 dims): [${vector
            .slice(0, 10)
            .map((v) => v.toFixed(4))
            .join(", ")} ...]`
        );
        console.log(` Vector Length: ${vector.length}`);
        // Basic stats
        const sum = vector.reduce((acc, val) => acc + val, 0);
        const mean = sum / vector.length;
        const min = Math.min(...vector);
        const max = Math.max(...vector);
        console.log(
          ` Vector Stats: Mean=${mean.toFixed(4)}, Min=${min.toFixed(
            4
          )}, Max=${max.toFixed(4)}`
        );
        console.log("===========================================");
      } else {
        console.log(
          `No vector found for object ID: ${functionObjectId}. Object exists? ${!!result}`
        );
      }
    } catch (error: any) {
      if (error.message && error.message.includes("404")) {
        console.log(
          `Object with ID ${functionObjectId} not found for vector printing.`
        );
      } else {
        console.error(
          `Error fetching vector embedding for ID ${functionObjectId}:`,
          error
        );
      }
    }
  }

  /**
   * Prints vector embeddings for all functions matching a specific name.
   * @param functionName The name of the function(s) to fetch embeddings for.
   */
  public async printVectorEmbeddingsForFunctions(
    functionName: string
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
      if (!this.isInitialized) return;
    }

    try {
      const result = await this.client.graphql
        .get()
        .withClassName(functionSchema.class)
        .withFields("functionName filePath _additional { id vector }") // Request vector here
        .withWhere({
          path: ["functionName"],
          operator: "Equal",
          valueString: functionName,
        })
        .withLimit(10) // Limit results for safety
        .do();

      const functions = result.data?.Get?.[functionSchema.class] || [];

      if (functions.length === 0) {
        console.log(`No functions found with name: ${functionName}`);
        return;
      }

      console.log(
        `\n=== Vector Embeddings for ${functions.length} functions named '${functionName}' ===`
      );
      for (const func of functions) {
        if (func._additional?.id && func._additional?.vector) {
          const vector = func._additional.vector as number[];
          console.log(`\n Object ID: ${func._additional.id}`);
          console.log(`  File Path: ${func.filePath || "N/A"}`);
          console.log(
            `  Vector (first 10 dims): [${vector
              .slice(0, 10)
              .map((v) => v.toFixed(4))
              .join(", ")} ...]`
          );
          console.log(`  Vector Length: ${vector.length}`);
        } else {
          console.log(
            `\n Vector not retrieved for function: ${func.functionName} (ID: ${func._additional?.id})`
          );
        }
      }
      console.log("=================================================");
    } catch (error: any) {
      console.error(
        `Error fetching vectors for function name '${functionName}':`,
        error
      );
      vscode.window.showErrorMessage(
        `Failed to fetch vectors: ${error.message || error}`
      );
    }
  }

  /**
   * Helper to print vectors for a list of parsed functions immediately after storage.
   * Uses the generated ID to fetch the stored object and its vector.
   * @param functions - Array of functions that were just parsed.
   * @param filePath - The path of the file they belong to.
   */
  private async debugPrintVectors(
    functions: ParsedFunction[],
    filePath: string
  ): Promise<void> {
    if (functions.length === 0) return;

    // Short delay to allow Weaviate to process batch and vectorization
    await new Promise((resolve) => setTimeout(resolve, 2500));

    console.log(
      "\n=== DEBUG: Printing Vectors for Recently Stored Functions ==="
    );

    for (const func of functions) {
      // Re-generate the *exact same ID* used during storage
      const objectId = createHash("sha256")
        .update(`${filePath}::${func.functionName}`)
        .digest("hex");

      await this.printVectorEmbedding(objectId); // Call the dedicated print function
    }
    console.log("=== END DEBUG VECTORS ===");
  }

  /**
   * Check if the VectorDBManager is initialized and ready to use.
   * @returns {boolean} True if initialized, false otherwise.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }
}
