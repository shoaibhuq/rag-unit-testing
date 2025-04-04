// Import necessary modules
import * as vscode from "vscode";
import OpenAI from "openai";
import { createHash } from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

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
  embedding?: number[];
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

/**
 * Simple vector similarity calculation using cosine similarity
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must be of the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class SimpleVectorManager {
  private openai: OpenAI;
  private isInitialized: boolean = false;
  private functionStore: FunctionData[] = [];
  private cacheDir: string;

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

      throw new Error("Missing OpenAI API Key for SimpleVectorManager");
    }

    // Initialize OpenAI client
    this.openai = new OpenAI({ apiKey: openaiApiKey });

    // Create cache directory
    this.cacheDir = path.join(workspaceRoot, ".vector-cache");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Initialize the vector manager
   * @returns {Promise<boolean>} True if initialized successfully
   */
  public async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      console.log("Initializing SimpleVectorManager...");

      // Try to load cached data if it exists
      const cacheFile = path.join(this.cacheDir, "function-embeddings.json");
      if (fs.existsSync(cacheFile)) {
        try {
          const data = fs.readFileSync(cacheFile, "utf8");
          this.functionStore = JSON.parse(data);
          console.log(
            `Loaded ${this.functionStore.length} cached function embeddings`
          );
        } catch (err: any) {
          console.warn(`Error loading cache file: ${err.message}`);
          // Continue with empty store if cache is corrupted
          this.functionStore = [];
        }
      }

      this.isInitialized = true;
      console.log("SimpleVectorManager initialized successfully.");
      return true;
    } catch (error: any) {
      console.error("Failed to initialize SimpleVectorManager:", error);
      vscode.window.showErrorMessage(
        `Failed to initialize vector storage: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Check if the manager is initialized and ready to use.
   * @returns {boolean} True if initialized, false otherwise.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Generate an embedding for a text using OpenAI's API
   * @param text The text to embed
   * @returns Promise with the embedding vector
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        dimensions: 1536,
      });

      return response.data[0].embedding;
    } catch (error: any) {
      console.error("Error generating embedding:", error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Save the current function store to disk
   */
  private async saveCache(): Promise<void> {
    const cacheFile = path.join(this.cacheDir, "function-embeddings.json");
    try {
      await fs.promises.writeFile(
        cacheFile,
        JSON.stringify(this.functionStore),
        "utf8"
      );
      console.log(
        `Saved ${this.functionStore.length} function embeddings to cache`
      );
    } catch (err: any) {
      console.warn(`Error saving cache file: ${err.message}`);
    }
  }

  /**
   * Parses functions from file content and stores them with embeddings.
   * @param filePath - The absolute path of the file being processed.
   * @param fileContent - The text content of the file.
   */
  public async storeFileContext(
    filePath: string,
    fileContent: string
  ): Promise<void> {
    if (!this.isInitialized) {
      console.log("Initializing SimpleVectorManager before storing context...");
      const initialized = await this.initialize();
      if (!initialized) {
        vscode.window.showErrorMessage(
          "Cannot store file context: Vector storage initialization failed."
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
        `Found ${functions.length} functions in ${filePath} to store:`
      );

      // Remove existing functions from this file path
      this.functionStore = this.functionStore.filter(
        (f) => f.filePath !== filePath
      );

      // Process each function
      for (const func of functions) {
        // Generate a consistent ID based on file path and function name
        const id = createHash("sha256")
          .update(`${filePath}::${func.functionName}`)
          .digest("hex");

        console.log(` - Processing ${func.functionName}`);

        // Generate an embedding for the function
        const embedding = await this.generateEmbedding(func.content);

        // Add to store
        this.functionStore.push({
          id,
          functionName: func.functionName,
          content: func.content,
          parameters: func.parameters,
          returnType: func.returnType,
          filePath,
          embedding,
        });
      }

      // Save to cache
      await this.saveCache();

      console.log(`Successfully stored ${functions.length} functions.`);
      vscode.window.showInformationMessage(
        `Successfully stored ${functions.length} functions from ${path.basename(
          filePath
        )}.`
      );
    } catch (error: any) {
      console.error("Error storing file context:", error);
      vscode.window.showErrorMessage(
        `Failed to store file context: ${error.message}`
      );
    }
  }

  /**
   * Searches for functions that are semantically similar to the provided text.
   * @param queryText - The text to search for similar functions.
   * @param limit - The maximum number of similar functions to return. Default is 5.
   * @returns A promise that resolves to an array of similar function objects or an empty array if none are found or an error occurs.
   */
  public async searchSimilarFunctions(
    queryText: string,
    limit: number = 5
  ): Promise<FunctionData[]> {
    if (!this.isInitialized) {
      console.warn(
        "Attempted search before SimpleVectorManager was initialized."
      );
      const initialized = await this.initialize();
      if (!initialized) {
        console.error("Failed to initialize SimpleVectorManager for search.");
        return [];
      }
    }

    try {
      if (this.functionStore.length === 0) {
        console.log("Function store is empty. Nothing to search.");
        return [];
      }

      console.log(
        `Searching for functions similar to query text (length: ${queryText.length})`
      );

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(queryText);

      // Find similar functions by computing cosine similarity
      const withSimilarity = this.functionStore
        .filter((func) => func.embedding && func.embedding.length > 0) // Ensure we have embeddings
        .map((func) => {
          // Calculate similarity
          const similarity = cosineSimilarity(queryEmbedding, func.embedding!);
          return {
            ...func,
            distance: 1 - similarity, // Convert similarity to distance (lower is better)
          };
        })
        .sort((a, b) => a.distance! - b.distance!); // Sort by distance (ascending)

      // Take top results
      const results = withSimilarity.slice(0, limit);

      console.log(`Found ${results.length} similar functions.`);

      // Log results for debugging
      results.forEach((func, i) => {
        console.log(
          ` - ${i + 1}. ${
            func.functionName
          } (Distance: ${func.distance!.toFixed(4)})`
        );
      });

      return results;
    } catch (error: any) {
      console.error("Error searching similar functions:", error);
      vscode.window.showErrorMessage(
        `Failed to search for similar functions: ${error.message}`
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
      console.log(`\n=== Functions matching name '${functionName}' ===`);

      // Filter functions by name
      const matchingFunctions = this.functionStore.filter((func) =>
        func.functionName.includes(functionName)
      );

      if (matchingFunctions.length === 0) {
        console.log(`No functions found with name: ${functionName}`);
        return;
      }

      console.log(`Found ${matchingFunctions.length} matching functions`);

      // Print each matching function
      matchingFunctions.forEach((func) => {
        console.log(`\n=== Function: ${func.functionName} ===`);
        console.log(`ID: ${func.id}`);
        console.log(`File Path: ${func.filePath || "N/A"}`);

        if (func.embedding && func.embedding.length > 0) {
          console.log(`Vector Dimensions: ${func.embedding.length}`);
          console.log(
            `First 10 dimensions: [${func.embedding
              .slice(0, 10)
              .map((v) => v.toFixed(4))
              .join(", ")}...]`
          );
        } else {
          console.log("No embedding vector available");
        }

        console.log("===========================================");
      });
    } catch (error: any) {
      console.error(`Error fetching vectors for '${functionName}':`, error);
      vscode.window.showErrorMessage(
        `Failed to fetch vectors: ${error.message}`
      );
    }
  }
}
