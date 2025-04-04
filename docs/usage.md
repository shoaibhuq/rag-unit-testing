# Extension Usage Guide

## Installation

1. Install the extension through VS Code marketplace or by using the VSIX file.
2. Configure your OpenAI API key using one of the methods described below.

## Configuration

### API Keys

The extension requires an OpenAI API key to function. You can set this in one of two ways:

1. **VS Code Settings**:

   - Open VS Code settings (File > Preferences > Settings)
   - Search for "RAG Unit Testing"
   - Enter your OpenAI API key in the designated field

2. **Extension Command**:

   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the command palette
   - Type "RAG Unit Testing: Configure"
   - Select "Set OpenAI API Key" and enter your key

3. **Environment File**:
   - Create a `.env` file in your workspace root
   - Add the line: `OPENAI_API_KEY=your_api_key_here`

### LangSmith Tracing

The extension supports LangSmith tracing to monitor and analyze your LLM interactions. You can enable it in two ways:

#### Method 1: VS Code Settings (Recommended)

1. Open VS Code settings (File > Preferences > Settings)
2. Search for "RAG Unit Testing"
3. Enable "Enable LangSmith" setting
4. Configure the following settings:
   - **LangSmith API Key**: Your LangSmith API key
   - **LangSmith Project**: The project name to use (default: "rag-unit-testing")
   - **LangSmith Endpoint**: The API endpoint (default: "https://api.smith.langchain.com")

#### Method 2: Environment Variables

1. **Install LangSmith Dependencies**:

   ```bash
   npm install -S langsmith
   ```

2. **Set Up Environment Variables**:
   Add the following to your `.env` file:

   ```
   LANGSMITH_TRACING=true
   LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
   LANGSMITH_API_KEY="your_langsmith_api_key"
   LANGSMITH_PROJECT="your_project_name"
   ```

#### Viewing Traces

- Go to [LangSmith dashboard](https://smith.langchain.com)
- Navigate to your project
- Review function calls, inputs, outputs, and performance metrics

LangSmith tracing helps debug LLM behavior, optimize prompts, and analyze token usage and latency.

### Additional Settings

You can customize the extension's behavior through these settings:

- **Disable Vector DB**: Toggle to run in LLM-only mode without vector embeddings
- **Model Selection**: Choose which OpenAI model to use for test generation

## Generating Unit Tests

1. **Open a C File**:

   - Open any C source file (`.c`) or header file (`.h`)

2. **Invoke the Command**:

   - Right-click in the editor and select "Generate Unit Test" from the context menu
   - Or use the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and search for "RAG Unit Testing: Generate Unit Test"

3. **Select Function**:

   - If a single function is detected, it will be used automatically
   - If multiple functions exist, you'll be prompted to select which one to test
   - If no function is detected, you can provide function information manually

4. **Wait for Generation**:

   - The extension will analyze the function, find similar functions, and generate a test
   - A progress indicator will show the current status

5. **Review the Test**:
   - A new file will be created and opened with the generated test
   - Review and modify the test as needed

## Advanced Features

### Vector Database Functionality

The extension uses a vector database to store and retrieve semantically similar functions:

- **Storage**: When you generate a test, the current file's functions are automatically stored
- **Retrieval**: Similar functions are retrieved to provide context for test generation
- **Caching**: Embeddings are cached to improve performance and reduce API calls

### View Vector Embeddings

For debugging or exploration, you can view vector embeddings:

1. Open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Search for "RAG Unit Testing: Print Vector Embeddings"
3. Enter a function name to search for
4. Check the Debug Console for the embedding information

## Troubleshooting

### Missing API Key

If you see an error about a missing API key:

- Ensure you've configured your OpenAI API key using one of the methods above
- Check that your API key is valid and has not expired

### Vector Database Issues

If you encounter problems with the vector database:

- The extension will continue to function in "LLM-only mode"
- You can explicitly disable the vector database in settings

### Generation Failures

If test generation fails:

- Check the Debug Console for detailed error information
- Ensure the function syntax is valid C code
- Try with a different function or modify the existing function
- Verify that your OpenAI API key has sufficient quota

## Support

For additional help:

- Check the extension's GitHub repository for issues and updates
- Review the documentation in the docs folder
- Submit issues through the GitHub issue tracker
