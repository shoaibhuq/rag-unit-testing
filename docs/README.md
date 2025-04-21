# RAG Unit Testing Extension Documentation

## Overview

The RAG Unit Testing extension is a VS Code tool designed to automatically generate unit tests for C functions using a combination of:

1. **LLMs (Large Language Models)** - Powered by OpenAI's GPT models to generate relevant test code
2. **RAG (Retrieval Augmented Generation)** - Provides context from similar functions to improve test quality
3. **Efficient Vector Embedding** - Stores and retrieves function context using semantic similarity
4. **LangSmith Integration** - Provides tracing and monitoring for LLM interactions

This documentation explains the architecture, components, and workflow of the extension.

## Architecture

The extension consists of four main components:

1. **Extension Core (`extension.ts`)** - Manages the VS Code integration, command registration, and LangGraph workflow
2. **Vector Embedding Manager (`simple-vector.ts`)** - Handles function storage, retrieval, and semantic search
3. **C Parser (`c-parser.ts`)** - Parses C code to extract functions and their metadata
4. **Python Test Generator (`python-test-generator.ts`)** - Generates Python test files from C test implementations

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
3. For Python test generation (when working with `testcase_*.c` files):
   - Analyzes the C test implementation file
   - Generates three interconnected Python files:
     - `test_<driver>_general.py` - Main pytest file
     - `fw_<driver>_general.py` - Test case enumeration mapping to C functions
     - `conftest.py` - Test configuration and fixtures

## Key Features

- **Caching System**: Aggressive multi-level caching (memory and disk) to reduce API calls
- **Batch Processing**: Combines multiple embedding requests into single API calls
- **Multiple Parsing Strategies**: Handles different C function styles and formats
- **Fallback Mechanisms**: Gracefully handles errors in parsing or vector DB connectivity
- **User Configuration**: VS Code settings for API keys and feature toggling
- **LangSmith Tracing**: Monitors LLM calls with detailed metrics and debugging tools
- **Python Test Generation**: Creates Python test files that integrate with C test implementations

## Component Documentation

- [Extension Core](extension.md) - Details on the extension implementation
- [Vector Embedding Manager](simple-vector.md) - Documentation for the vector storage system
- [C Parser](c-parser.md) - Explanation of the C code parsing functionality
- [Python Test Generator](python-test-generator.md) - Documentation for the Python test generation feature

## Usage

See the [Extension Usage Guide](usage.md) for detailed instructions on how to use the extension.

### Generating Python Test Files

To generate Python test files from a C test implementation:

1. Right-click on a `testcase_*.c` file in the VS Code explorer or editor
2. Select "Generate Python Test Files - RAG Unit Testing" from the context menu
3. The extension will generate three Python files:
   - `test_<driver>_general.py` - Main pytest file with test cases
   - `fw_<driver>_general.py` - Test case enumeration that maps to C implementations
   - `conftest.py` - Test configuration and fixtures (if it doesn't already exist)

The generated Python files follow TI's test framework conventions and provide a complete test infrastructure to run the C test implementations.
