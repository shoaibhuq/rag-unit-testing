# RAG Unit Testing Extension Documentation

## Overview

The RAG Unit Testing extension is a VS Code tool designed to automatically generate unit tests for C functions using a combination of:

1. **LLMs (Large Language Models)** - Powered by OpenAI's GPT models to generate relevant test code
2. **RAG (Retrieval Augmented Generation)** - Provides context from similar functions to improve test quality
3. **Efficient Vector Embedding** - Stores and retrieves function context using semantic similarity

This documentation explains the architecture, components, and workflow of the extension.

## Architecture

The extension consists of three main components:

1. **Extension Core (`extension.ts`)** - Manages the VS Code integration, command registration, and LangGraph workflow
2. **Vector Embedding Manager (`simple-vector.ts`)** - Handles function storage, retrieval, and semantic search
3. **C Parser (`c-parser.ts`)** - Parses C code to extract functions and their metadata

## Workflow

The extension follows this workflow when generating unit tests:

1. When activated, the extension initializes the vector manager and C parser
2. Upon invoking the test generation command, the extension:
   - Parses the current C file to identify functions
   - Stores function contexts in the vector database
   - Retrieves similar functions based on semantic similarity
   - Uses LangGraph to orchestrate the generation workflow
   - Invokes OpenAI to generate the test code
   - Creates and opens a new test file with the generated code

## Key Features

- **Caching System**: Aggressive multi-level caching (memory and disk) to reduce API calls
- **Batch Processing**: Combines multiple embedding requests into single API calls
- **Multiple Parsing Strategies**: Handles different C function styles and formats
- **Fallback Mechanisms**: Gracefully handles errors in parsing or vector DB connectivity
- **User Configuration**: VS Code settings for API keys and feature toggling

## Component Documentation

- [Extension Core](extension.md) - Details on the extension implementation
- [Vector Embedding Manager](simple-vector.md) - Documentation for the vector storage system
- [C Parser](c-parser.md) - Explanation of the C code parsing functionality

## Usage

See the [Extension Usage Guide](usage.md) for detailed instructions on how to use the extension.
