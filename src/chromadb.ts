// Import necessary modules
import * as vscode from "vscode";
import { ChromaClient, Collection, OpenAIEmbeddingFunction } from "chromadb";
import { createHash } from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

// Define custom interface for client parameters as a workaround for missing type
interface ChromaClientParams {
  path?: string;
  fetchOptions?: any;
}

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
  id?: string;
  distance?: number;
}

// Interface for parsed function data
interface ParsedFunction {
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
}

/**
 * Parses C functions from file content using regular expressions.
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
  const functionRegex =
    /^([\w\s\*]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:;|\{([\s\S]*?)(?:^|\n)\s*\})/gm;

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

export class ChromaDBManager {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private embeddingFunction: OpenAIEmbeddingFunction | null = null;
  private isInitialized: boolean = false;
  private collectionName: string = "c_functions";
  private useInMemory: boolean = false;

  constructor() {
    // Try to get credentials from VS Code settings first
    const config = vscode.workspace.getConfiguration("rag-unit-testing");

    // Get API key from VS Code settings if available, otherwise use .env
    const openaiApiKey =
      (config.get("openaiApiKey") as string) || process.env.OPENAI_API_KEY;

    // Debug output for credential sources and values
    console.log("Credentials configuration:");
    console.log(
      `- OPENAI_API_KEY source: ${
        config.get("openaiApiKey") ? "VS Code settings" : "Environment variable"
      }`
    );

    // Debug output with partial redaction for security
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

    if (!openaiApiKey) {
      const errorMsg = `Missing required OpenAI API Key for vector embeddings. Please set it in either:
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

      throw new Error("Missing OpenAI API Key for ChromaDBManager");
    }

    // Initialize Chroma client
    try {
      // Start with attempting to use a local server
      const clientConfig: ChromaClientParams = {
        path: "http://localhost:8000", // Default path for local ChromaDB
      };

      // Get configuration to check if in-memory mode is preferred
      this.useInMemory = config.get("useInMemoryVectorDB") === true;

      if (this.useInMemory) {
        console.log("Using in-memory ChromaDB (no server required)");
        // For in-memory mode, don't provide a path
        delete clientConfig.path;
      }

      this.client = new ChromaClient(clientConfig);

      // Create embedding function using OpenAI
      this.embeddingFunction = new OpenAIEmbeddingFunction({
        openai_api_key: openaiApiKey,
        openai_model: "text-embedding-3-small", // Corrected property name
      });
    } catch (error: any) {
      console.error("Failed to create ChromaDB client:", error);
      vscode.window.showErrorMessage(
        `Failed to create ChromaDB client: ${error.message || error}`
      );
      throw error;
    }
  }

  /**
   * Initializes the ChromaDB collection if it doesn't exist.
   * @returns {Promise<boolean>} True if initialized successfully or already initialized, false otherwise.
   */
  public async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      console.log("Attempting to connect to ChromaDB...");

      let collections;
      try {
        // Try to get collections (this will fail if server isn't running)
        collections = await this.client.listCollections();
        console.log(`Found ${collections.length} collections in ChromaDB`);
      } catch (error) {
        // If server connection failed and we're not already in in-memory mode, switch to it
        if (!this.useInMemory) {
          console.log(
            "Failed to connect to ChromaDB server, switching to in-memory mode"
          );
          // Recreate client without a path for in-memory mode
          this.client = new ChromaClient();
          this.useInMemory = true;

          // Try again with in-memory client
          collections = await this.client.listCollections();
          console.log(
            `Using in-memory ChromaDB (found ${collections.length} collections)`
          );

          // Update the user settings to reflect this change
          const config = vscode.workspace.getConfiguration("rag-unit-testing");
          await config.update(
            "useInMemoryVectorDB",
            true,
            vscode.ConfigurationTarget.Global
          );
          vscode.window.showInformationMessage(
            "Using in-memory vector database (no server required)"
          );
        } else {
          // If we're already trying in-memory mode and still failing, rethrow
          throw error;
        }
      }

      // Check if our collection exists
      const collectionExists = collections.some(
        (c: any) => c.name === this.collectionName
      );

      if (collectionExists) {
        console.log(`Collection '${this.collectionName}' already exists.`);
        this.collection = await this.client.getCollection({
          name: this.collectionName,
          embeddingFunction: this.embeddingFunction!,
        });
      } else {
        console.log(
          `Collection '${this.collectionName}' not found. Creating...`
        );
        try {
          this.collection = await this.client.createCollection({
            name: this.collectionName,
            embeddingFunction: this.embeddingFunction!,
            metadata: {
              description: "C functions for RAG unit test generation",
            },
          });
          console.log(`Created collection: ${this.collectionName}`);
        } catch (error: any) {
          throw new Error(
            `Failed to create collection: ${error.message || "Unknown error"}`
          );
        }
      }

      this.isInitialized = true;
      console.log("ChromaDBManager initialized successfully.");
      return true;
    } catch (error: any) {
      this.isInitialized = false;

      // Provide more specific error message based on error type
      let errorMessage = "Failed to initialize ChromaDB: ";

      if (error.message && error.message.includes("ECONNREFUSED")) {
        errorMessage +=
          "Connection refused. Is ChromaDB server running? Try enabling in-memory mode in settings.";
      } else {
        errorMessage += error.message || String(error);
      }

      console.error(errorMessage);
      vscode.window.showErrorMessage(errorMessage);

      return false;
    }
  }

  /**
   * Check if the ChromaDBManager is initialized and ready to use.
   * @returns {boolean} True if initialized, false otherwise.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Parses functions from file content and stores them in ChromaDB.
   * Uses a batch operation for efficiency.
   * @param filePath - The absolute path of the file being processed.
   * @param fileContent - The text content of the file.
   */
  public async storeFileContext(
    filePath: string,
    fileContent: string
  ): Promise<void> {
    if (!this.isInitialized) {
      console.log("Initializing ChromaDBManager before storing context...");
      const initialized = await this.initialize();
      if (!initialized) {
        vscode.window.showErrorMessage(
          "Cannot store file context: ChromaDB initialization failed."
        );
        return;
      }
    }

    try {
      // Parse the C functions from the file content
      const functions = parseCFunctions(fileContent);

      if (functions.length === 0) {
        console.log("No functions found by parser in:", filePath);
        vscode.window.showInformationMessage(
          "No functions found to store from this file."
        );
        return;
      }

      console.log(
        `Found ${functions.length} functions in ${filePath} to store/update in ChromaDB:`
      );
      functions.forEach((func) => console.log(` - ${func.functionName}`));

      // Prepare data for batch upsert
      const ids: string[] = [];
      const documents: string[] = [];
      const metadatas: any[] = [];

      // Add each function to the batch
      for (const func of functions) {
        // Generate a consistent ID based on file path and function name
        const objectId = createHash("sha256")
          .update(`${filePath}::${func.functionName}`)
          .digest("hex");

        ids.push(objectId);
        documents.push(func.content);
        metadatas.push({
          functionName: func.functionName,
          returnType: func.returnType,
          parameters: func.parameters.join(","),
          filePath: filePath,
        });
      }

      // Execute the batch operation
      await this.collection!.upsert({
        ids: ids,
        documents: documents,
        metadatas: metadatas,
      });

      console.log(
        `Successfully stored ${functions.length} functions in ChromaDB.`
      );
      vscode.window.showInformationMessage(
        `Successfully stored ${functions.length} functions from ${path.basename(
          filePath
        )}.`
      );
    } catch (error: any) {
      console.error("Error storing file context in ChromaDB:", error);
      vscode.window.showErrorMessage(
        `Failed to store file context: ${error.message}`
      );
    }
  }

  /**
   * Searches for functions in ChromaDB that are semantically similar to the provided text.
   * @param queryText - The text to search for similar functions.
   * @param limit - The maximum number of similar functions to return. Default is 5.
   * @returns A promise that resolves to an array of similar function objects or an empty array if none are found or an error occurs.
   */
  public async searchSimilarFunctions(
    queryText: string,
    limit: number = 5
  ): Promise<FunctionData[]> {
    if (!this.isInitialized) {
      console.warn("Attempted search before ChromaDBManager was initialized.");
      const initialized = await this.initialize();
      if (!initialized) {
        console.error("Failed to initialize ChromaDBManager for search.");
        return [];
      }
    }

    try {
      console.log(`Searching for functions similar to: "${queryText}"`);

      const results = await this.collection!.query({
        queryTexts: [queryText],
        nResults: limit,
      });

      if (
        !results ||
        !results.ids ||
        results.ids.length === 0 ||
        !results.ids[0]
      ) {
        console.log("No similar functions found.");
        return [];
      }

      // Transform results into FunctionData format
      const similarFunctions: FunctionData[] = [];

      // We know there's only one query text, so we use index 0
      const ids = results.ids[0] || [];
      const documents = results.documents[0] || [];
      const metadatas = results.metadatas[0] || [];
      const distances = results.distances?.[0] || [];

      for (let i = 0; i < ids.length; i++) {
        const metadata = metadatas[i] || {};

        // Ensure correct types for metadata properties
        const functionName = String(metadata.functionName || "");
        const returnType = String(metadata.returnType || "");
        const parametersStr = String(metadata.parameters || "");
        const filePath =
          typeof metadata.filePath === "string" ? metadata.filePath : undefined;

        similarFunctions.push({
          id: String(ids[i]),
          content: String(documents[i] || ""),
          functionName,
          returnType,
          parameters: parametersStr.split(",").filter(Boolean),
          filePath,
          distance: distances[i],
        });
      }

      console.log(`Found ${similarFunctions.length} similar functions.`);

      // Log found functions and their distances for debugging
      similarFunctions.forEach((f) => {
        const distance =
          f.distance !== undefined ? f.distance.toFixed(4) : "N/A";
        console.log(` - ${f.functionName} (Distance: ${distance})`);
      });

      return similarFunctions;
    } catch (error: any) {
      console.error("Error searching similar functions in ChromaDB:", error);
      vscode.window.showErrorMessage(
        `Failed to search for similar functions: ${error.message || error}`
      );
      return [];
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
      console.log(`\n=== Searching for functions named '${functionName}' ===`);

      // First get the IDs by searching for the function name
      const results = await this.collection!.query({
        queryTexts: [functionName],
        nResults: 5,
      });

      if (
        !results ||
        !results.ids ||
        results.ids.length === 0 ||
        !results.ids[0]
      ) {
        console.log(`No functions found with name: ${functionName}`);
        return;
      }

      console.log(
        `Found ${results.ids[0].length} functions matching '${functionName}'`
      );

      // Get the documents and metadata directly
      const ids = results.ids[0] || [];
      const documents = results.documents[0] || [];
      const metadatas = results.metadatas[0] || [];

      for (let i = 0; i < ids.length; i++) {
        const metadata = metadatas[i] || {};

        console.log(
          `\n=== Function: ${metadata.functionName || "Unknown"} ===`
        );
        console.log(`ID: ${ids[i]}`);
        console.log(`File Path: ${metadata.filePath || "N/A"}`);
        console.log(
          `Content (excerpt): ${(documents[i] || "").substring(0, 100)}...`
        );
        console.log(
          "Note: ChromaDB doesn't provide direct embedding access in query results"
        );
        console.log("===========================================");
      }
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
}
