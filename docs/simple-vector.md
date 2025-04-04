# Vector Embedding Manager Documentation

## Overview

The `simple-vector.ts` file implements the `SimpleVectorManager` class, which provides vector embedding functionality for storing and retrieving C functions based on semantic similarity. This component is central to the RAG (Retrieval Augmented Generation) capability of the extension.

## Architecture

The `SimpleVectorManager` combines several key techniques:

1. **Vector Embeddings**: Using OpenAI's embedding models to convert code into numeric vectors
2. **Similarity Search**: Finding related functions using cosine similarity
3. **Multi-Level Caching**: Reducing API calls through memory and disk caching
4. **Batch Processing**: Optimizing embedding generation through batched API calls

## Core Components

### Initialization & Configuration

```typescript
constructor() { ... }
public async initialize(): Promise<boolean> { ... }
```

- Loads configuration from VS Code settings and environment variables
- Creates cache directories for persistent storage
- Loads previously cached embeddings from disk
- Validates API keys

### Embedding Generation

```typescript
private async generateEmbedding(text: string): Promise<number[]> { ... }
private async processBatch(): Promise<void> { ... }
```

The embedding system implements several optimization strategies:

1. **In-Memory Caching**: Stores embeddings in RAM with TTL (1 week default)
2. **Disk Caching**: Persists embeddings to JSON files
3. **Request Deduplication**: Prevents duplicate in-flight requests for the same text
4. **Batch Processing**: Combines multiple embedding requests into single API calls

### Function Storage

```typescript
public async storeFileContext(filePath: string, fileContent: string): Promise<void> { ... }
private async saveCache(): Promise<void> { ... }
```

- Parses C functions from file content
- Generates embeddings for each function
- Stores functions with their embeddings
- Saves to persistent cache

### Similarity Search

```typescript
public async searchSimilarFunctions(queryText: string, limit: number = 5): Promise<FunctionData[]> { ... }
```

- Generates embedding for the query text
- Computes cosine similarity with stored functions
- Returns the most semantically similar functions

### Debugging & Diagnostics

```typescript
public async printVectorEmbeddingsForFunctions(functionName: string): Promise<void> { ... }
```

- Retrieves and displays embeddings for specific functions
- Used for debugging and verification

## Caching System

The caching system operates on multiple levels:

1. **In-Memory Cache**:

   - `embeddingCache`: Stores embeddings with expiration timestamps
   - Prevents redundant API calls for the same text
   - Automatically expires entries after 1 week

2. **Disk Cache**:
   - `.vector-cache/embedding-cache.json`: Raw embeddings with metadata
   - `.vector-cache/function-embeddings.json`: Complete function data with embeddings
   - Loaded during initialization
   - Saved periodically (10% of requests) and on shutdown

## Batch Processing

The batch processing system optimizes API usage:

1. **Request Queuing**:

   - Incoming embedding requests are added to a queue
   - A timer processes the queue in batches

2. **Batch Execution**:
   - Up to `BATCH_SIZE` (10) texts are processed in a single API call
   - Results are matched with original requests and cached
   - Error handling includes retries with exponential backoff

## Function Parsing

The manager includes a basic C function parser (`parseCFunctions`):

- Removes comments from C code
- Uses regex to identify function definitions
- Extracts function metadata (name, parameters, return type)

## Resource Management

```typescript
public dispose(): void { ... }
```

- Saves caches before shutdown
- Clears any pending timers
- Ensures clean termination of resources
