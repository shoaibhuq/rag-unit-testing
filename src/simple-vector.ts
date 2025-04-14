// Import necessary modules
import * as vscode from "vscode";
import OpenAI from "openai";
import { createHash } from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { CParser, ParsedFunction } from "./c-parser";
import { PythonParser, PythonCodeElement } from "./python-parser";

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
interface StoredFunction {
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
  filePath?: string;
  id?: string;
  distance?: number;
  embedding?: number[];
  lastUpdated?: number; // Timestamp for cache control
  language?: 'c' | 'python'; // Add language field to distinguish between C and Python
  className?: string; // For Python class methods
  isMethod?: boolean; // For Python class methods
  decorators?: string[]; // For Python decorators
}

// Interface for the embedding cache
interface EmbeddingCache {
  [key: string]: {
    embedding: number[];
    timestamp: number;
    expiresAt: number;
  };
}

// Cache configuration
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 1 week in milliseconds
const BATCH_SIZE = 10; // Maximum batch size for embedding generation

// Initialize parsers
const cParser = new CParser();
const pythonParser = new PythonParser();

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
  private functionStore: StoredFunction[] = [];
  private cacheDir: string;
  private embeddingCache: EmbeddingCache = {}; // In-memory cache
  private pendingEmbeddings: Map<string, Promise<number[]>> = new Map(); // To prevent duplicate requests
  private batchQueue: {
    text: string;
    resolve: (embedding: number[]) => void;
    reject: (error: Error) => void;
  }[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

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

    // Load embedding cache from disk
    this.loadEmbeddingCache();
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
   * Load embedding cache from disk
   */
  private loadEmbeddingCache(): void {
    try {
      const cacheFile = path.join(this.cacheDir, "embedding-cache.json");
      if (fs.existsSync(cacheFile)) {
        const data = fs.readFileSync(cacheFile, "utf8");
        this.embeddingCache = JSON.parse(data);

        // Clean expired cache entries
        const now = Date.now();
        let expiredCount = 0;

        Object.keys(this.embeddingCache).forEach((key) => {
          if (this.embeddingCache[key].expiresAt < now) {
            delete this.embeddingCache[key];
            expiredCount++;
          }
        });

        console.log(
          `Loaded embedding cache with ${
            Object.keys(this.embeddingCache).length
          } entries (removed ${expiredCount} expired entries)`
        );
      } else {
        console.log("No embedding cache file found, starting with empty cache");
        this.embeddingCache = {};
      }
    } catch (error) {
      console.warn("Error loading embedding cache:", error);
      this.embeddingCache = {};
    }
  }

  /**
   * Save embedding cache to disk
   */
  private saveEmbeddingCache(): void {
    try {
      const cacheFile = path.join(this.cacheDir, "embedding-cache.json");
      fs.writeFileSync(cacheFile, JSON.stringify(this.embeddingCache), "utf8");
      console.log(
        `Saved embedding cache with ${
          Object.keys(this.embeddingCache).length
        } entries`
      );
    } catch (error) {
      console.warn("Error saving embedding cache:", error);
    }
  }

  /**
   * Generate an embedding for a text using OpenAI's API with batching and caching
   * @param text The text to embed
   * @returns Promise with the embedding vector
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Create a hash of the text to use as a cache key
    const textHash = createHash("sha256").update(text).digest("hex");

    // Check if this embedding is already being processed
    if (this.pendingEmbeddings.has(textHash)) {
      console.log("Reusing in-flight embedding request");
      return this.pendingEmbeddings.get(textHash)!;
    }

    // Check if we have this in cache
    if (
      this.embeddingCache[textHash] &&
      this.embeddingCache[textHash].expiresAt > Date.now()
    ) {
      console.log("Using cached embedding");
      return this.embeddingCache[textHash].embedding;
    }

    // Create a promise that will be resolved with the embedding
    const embeddingPromise = new Promise<number[]>((resolve, reject) => {
      // Add to batch queue
      this.batchQueue.push({
        text,
        resolve,
        reject,
      });

      // Set a timer to process the batch if it's not already set
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatch(), 100);
      }
    });

    // Store the promise so we can reuse it if the same text is requested
    this.pendingEmbeddings.set(textHash, embeddingPromise);

    // Once the promise is resolved or rejected, remove it from the pending map
    embeddingPromise.finally(() => {
      this.pendingEmbeddings.delete(textHash);
    });

    return embeddingPromise;
  }

  /**
   * Process the batch of embedding requests
   */
  private async processBatch(): Promise<void> {
    this.batchTimer = null;

    // If no requests in queue, do nothing
    if (this.batchQueue.length === 0) return;

    // Take items from the queue up to the batch size limit
    const batch = this.batchQueue.splice(0, BATCH_SIZE);
    const texts = batch.map((item) => item.text);

    console.log(`Processing batch of ${batch.length} embedding requests`);

    try {
      // Make a single API call for all texts in the batch
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
        dimensions: 1536,
      });

      // Match results with original requests and update cache
      response.data.forEach((result, index) => {
        const item = batch[index];
        const textHash = createHash("sha256").update(item.text).digest("hex");

        // Update cache
        this.embeddingCache[textHash] = {
          embedding: result.embedding,
          timestamp: Date.now(),
          expiresAt: Date.now() + CACHE_TTL,
        };

        // Resolve the promise with the embedding
        item.resolve(result.embedding);
      });

      // Save the updated cache periodically (we don't want to save after every batch)
      if (Math.random() < 0.1) {
        // 10% chance of saving
        this.saveEmbeddingCache();
      }

      // Process any remaining items in the queue
      if (this.batchQueue.length > 0) {
        this.batchTimer = setTimeout(() => this.processBatch(), 100);
      }
    } catch (error: any) {
      console.error("Error generating embeddings batch:", error);

      // Reject all promises in the batch
      batch.forEach((item) => {
        item.reject(
          new Error(`Failed to generate embedding: ${error.message}`)
        );
      });

      // Process any remaining items after a delay
      if (this.batchQueue.length > 0) {
        this.batchTimer = setTimeout(() => this.processBatch(), 1000); // Longer delay after error
      }
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
    try {
      // Determine file type from extension
      const ext = path.extname(filePath).toLowerCase();
      let functions: ParsedFunction[] = [];

      if (ext === '.c' || ext === '.h') {
        functions = cParser.parseFunctions(fileContent, filePath);
      } else if (ext === '.py') {
        // Convert PythonCodeElement to ParsedFunction
        const pythonElements = pythonParser.parseContent(fileContent, filePath).elements;
        functions = pythonElements
          .filter(element => element.type === 'function' || element.type === 'method')
          .map(element => ({
            functionName: element.name,
            content: element.content,
            parameters: element.parameters,
            returnType: element.returnType || 'any',
            className: element.parentClass,
            isMethod: element.type === 'method',
            decorators: element.decorators
          }));
      } else {
        console.log(`Skipping unsupported file type: ${ext}`);
        return;
      }

      // Process each function
      for (const func of functions) {
        const functionData: StoredFunction = {
          ...func,
          filePath,
          id: createHash('md5')
            .update(`${func.functionName}-${filePath}`)
            .digest('hex'),
          lastUpdated: Date.now(),
        };

        // Check if function already exists in store
        const existingIndex = this.functionStore.findIndex(
          (f) => f.id === functionData.id
        );

        if (existingIndex !== -1) {
          // Update existing function
          this.functionStore[existingIndex] = {
            ...this.functionStore[existingIndex],
            ...functionData,
          };
        } else {
          // Add new function
          this.functionStore.push({
            ...functionData,
          });
        }
      }

      // Save updated store to cache
      await this.saveCache();
    } catch (error) {
      console.error("Error storing file context:", error);
      throw error;
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
  ): Promise<StoredFunction[]> {
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
          
          // Apply language-specific adjustments if needed
          let adjustedSimilarity = similarity;
          
          // For Python functions, we might want to adjust the similarity based on
          // Python-specific features like decorators or class membership
          if (func.language === 'python') {
            // For now, we'll keep the similarity as is
            // In the future, we could add Python-specific adjustments here
          }
          
          return {
            ...func,
            distance: 1 - adjustedSimilarity, // Convert similarity to distance (lower is better)
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
          } (${func.language || 'unknown'} function, Distance: ${func.distance!.toFixed(4)})`
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
        console.log(`Language: ${func.language || "unknown"}`);
        
        // Print Python-specific information if available
        if (func.language === 'python') {
          if (func.className) {
            console.log(`Class: ${func.className}`);
          }
          if (func.isMethod) {
            console.log(`Type: Method`);
          } else {
            console.log(`Type: Function`);
          }
          if (func.decorators && func.decorators.length > 0) {
            console.log(`Decorators: ${func.decorators.join(', ')}`);
          }
        }
        
        console.log(
          `Last Updated: ${
            func.lastUpdated
              ? new Date(func.lastUpdated).toLocaleString()
              : "Unknown"
          }`
        );

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

  /**
   * Clean up resources when deactivating the extension
   */
  public dispose(): void {
    // Save caches
    this.saveCache();
    this.saveEmbeddingCache();

    // Clear any pending timers
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    console.log("SimpleVectorManager disposed");
  }
}