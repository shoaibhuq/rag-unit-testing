// Import necessary VS Code and Node.js modules
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises"; // Use promises for async file operations

// Import local modules
import { SimpleVectorManager } from "./simple-vector"; // Import our simple vector manager
import { CParser } from "./c-parser"; // Import our advanced C parser
import { PythonParser, PythonCodeElement } from "./python-parser";

// Import LangChain and LangGraph components
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  StateGraph,
  END,
  START,
  CompiledStateGraph,
  StateDefinition,
  StateGraphArgs,
} from "@langchain/langgraph"; // Import START constant explicitly
import { RunnableLambda } from "@langchain/core/runnables";

// Add LangSmith imports
import { Client } from "langsmith";
import { LangChainTracer } from "langchain/callbacks";

// Load configuration settings
import { loadConfig } from './config';

const config = loadConfig();

// Example usage:
console.log("LLM Model:", config.llm.model);
console.log("Included Files:", config.analyze.includedFiles);

// --- LangGraph Setup ---

// Define the state interface for the graph
interface GraphState {
  functionName: string; // Name of the function to test
  functionCode: string; // Source code of the function to test
  filePath: string; // Path to the source file
  similarFunctionsCode?: string; // Code of similar functions (context)
  generatedTestCode?: string; // The final generated unit test code
  errorMessage?: string; // To capture errors during graph execution
  language: 'c' | 'python'; // Language of the function
  className?: string; // For Python class methods
  isMethod?: boolean; // For Python class methods
  decorators?: string[]; // For Python decorators
  parameters?: string[]; // Function parameters
  returnType?: string; // Function return type
}

// Define a common interface for parsed functions
export interface ParsedFunction {
  functionName: string;
  className?: string;
  parameters: string[];
  returnType?: string;
  content: string;
  decorators?: string[];
  isMethod?: boolean;
}

// Define the graph nodes

/**
 * Node: Retrieves context (similar functions) from the vector database.
 */
async function retrieveContext(
  state: GraphState,
  vectorManager: SimpleVectorManager | null
): Promise<Partial<GraphState>> {
  console.log(`[${new Date().toISOString()}] --- Node: retrieveContext ---`);
  // Handle case where vectorManager is not available
  if (!vectorManager || !(vectorManager as any).isReady()) {
    console.warn(
      "Vector database not available - continuing without RAG context"
    );
    return {
      similarFunctionsCode:
        "// Vector database not available. Generating tests without similar function context.",
    };
  }
  try {
    // Search for functions similar to the target function's code
    const similarFunctions = await vectorManager.searchSimilarFunctions(
      state.functionCode,
      3
    ); // Limit to 3

    if (similarFunctions && similarFunctions.length > 0) {
      const context = similarFunctions
        .map(
          (f) =>
            `// Similar function from ${path.basename(
              f.filePath || "unknown_file"
            )}\n${f.content || ""}`
        ) // Add fallback for potentially missing properties
        .join("\n\n---\n\n");
      console.log(
        `Retrieved ${similarFunctions.length} similar functions as context.`
      );
      return { similarFunctionsCode: context };
    } else {
      console.log("No similar functions found.");
      return {
        similarFunctionsCode: "// No similar functions found in the database.",
      };
    }
  } catch (error: any) {
    console.error("Error retrieving context:", error);
    return {
      similarFunctionsCode: `// Error retrieving context: ${error.message}. Generating tests without RAG.`,
    };
  }
}

/**
 * Node: Generates unit test code using an LLM.
 */
async function generateTests(state: GraphState): Promise<Partial<GraphState>> {
  console.log(`[${new Date().toISOString()}] --- Node: generateTests starting ---`);
  if (!state.functionCode) {
    console.error("Function code is missing, cannot generate tests.");
    return { errorMessage: "Function code is missing, cannot generate tests." };
  }

  // Get OpenAI API key from VS Code settings or environment variables
  const config = vscode.workspace.getConfiguration("rag-unit-testing");
  const openaiApiKey = (config.get("openaiApiKey") as string) || process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.error("OpenAI API key is not configured in either VS Code settings or environment variables.");
    return { errorMessage: "OpenAI API key is not configured in either VS Code settings or environment variables." };
  }

  console.log(`[${new Date().toISOString()}] OpenAI API key found (length: ${openaiApiKey.length})`);
  console.log(`[${new Date().toISOString()}] Creating LLM instance with model: gpt-4o-mini`);

  try {
    const llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
      apiKey: openaiApiKey,
    });

    // Enable LangSmith tracing for the LLM if configured
    if (langsmithTracingEnabled && process.env.LANGSMITH_API_KEY) {
      console.log("Adding LangSmith tracing to LLM");
      const tracer = new LangChainTracer({
        projectName: process.env.LANGSMITH_PROJECT || "rag-unit-testing",
        client: new Client({
          apiKey: process.env.LANGSMITH_API_KEY,
          apiUrl: process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
        }),
      });
      llm.callbacks = [tracer];
    }

    console.log(`[${new Date().toISOString()}] LLM initialized, preparing prompt template`);

    // Choose the appropriate prompt template based on the language
    const testGenPrompt = state.language === 'python' 
      ? PromptTemplate.fromTemplate(
          `You are an expert Python programmer specializing in unit testing with pytest and unittest.
          Your task is to generate comprehensive unit tests for the given Python function.

          **Function to Test:**
          File Path: {filePath}
          \`\`\`python
          {functionCode}
          \`\`\`

          **Context (Code from similar functions found in the project):**
          \`\`\`python
          {similarFunctionsCode}
          \`\`\`

          **Function Details:**
          - Name: {functionName}
          - Parameters: {parameters}
          - Return Type: {returnType}
          - Class: {className}
          - Is Method: {isMethod}
          - Decorators: {decorators}

          **Instructions:**
          1. Analyze the function code ({functionName}) provided above.
          2. Consider edge cases, typical inputs, boundary conditions, and potential error scenarios.
          3. Generate a complete Python test file using pytest as the primary framework, with unittest compatibility.
          4. Include the following components:
             - Necessary imports (pytest, unittest, any required modules)
             - Test fixtures using @pytest.fixture
             - Test classes if testing class methods
             - Test functions with appropriate naming (test_{functionName}_...)
             - Appropriate assertions (assert, pytest.raises, etc.)
          5. Handle specific Python features:
             - If the function is async, use pytest.mark.asyncio and async/await
             - If the function uses context managers, test with 'with' statements
             - If the function has decorators, test their effects
             - If testing class methods, include class setup/teardown
             - If the function raises exceptions, test with pytest.raises
          6. Include comprehensive test cases:
             - Happy path (normal operation)
             - Edge cases (empty inputs, boundary values)
             - Error cases (invalid inputs, exceptions)
             - Type checking (if type hints are present)
             - State verification (if the function modifies state)
          7. Add detailed docstrings and comments explaining:
             - Purpose of each test case
             - Expected behavior
             - Any special conditions or setup
          8. Use pytest features:
             - Parametrized tests for multiple test cases
             - Fixtures for setup/teardown
             - Markers for test categorization
             - Skip/xfail for conditional tests

          Generate only the test code, with no additional explanation or markdown formatting.`
        )
      : PromptTemplate.fromTemplate(
        
          `You are an expert C programmer specializing in unit testing with the Unity framework.
          Your task is to generate comprehensive unit tests for the given C function.

          **Function to Test:**
          File Path: {filePath}
          \`\`\`c
          {functionCode}
          \`\`\`

          **Context (Code from similar functions found in the project):**
          \`\`\`c
          {similarFunctionsCode}
          \`\`\`

          **Instructions:**
          1.  Analyze the function code ({functionName}) provided above.
          2.  Consider edge cases, typical inputs, boundary conditions, and potential error scenarios.
          3.  Use the Unity testing framework syntax (e.g., TEST_ASSERT_EQUAL_INT, TEST_ASSERT_NULL, setUp, tearDown).
          4.  Generate a complete C file containing the necessary includes (#include "unity.h", #include "{functionName}.h"), setUp, tearDown (if needed, otherwise leave empty), and test functions (test_{functionName}_...).
          5.  Include a main function that initializes Unity (UNITY_BEGIN/END) and runs the generated test functions (RUN_TEST).
          6.  Focus on testing the logic within the provided function code. Use the context for understanding potential usage patterns but do not test the context functions directly.
          7.  If the function involves pointers, test null pointer inputs if applicable.
          8.  If the function involves arrays or buffers, test boundary conditions (e.g., empty, full, oversized).
          9.  Add comments explaining the purpose of each test case.
          10. Ensure the generated code is clean, well-formatted, and syntactically correct C.

          **Output:**
          Provide only the complete C code for the unit test file. Do not include any explanations outside the code comments.

          **Generated Unit Test Code:**
          `
    );

    const testGeneratorChain = testGenPrompt
      .pipe(llm)
      .pipe(new StringOutputParser());

    console.log(
      `[${new Date().toISOString()}] === Invoking LLM for test generation ===`
    );
    console.log(`Function name: ${state.functionName}`);
    console.log(`File path: ${state.filePath}`);
    console.log(`Test prompt prepared, making API call to OpenAI...`);

    const startTime = Date.now();
    vscode.window.showInformationMessage(
      `Generating tests for ${state.functionName} with GPT-4...`
    );

    const generatedCode = await testGeneratorChain.invoke({
      filePath: state.filePath,
      functionName: state.functionName,
      functionCode: state.functionCode,
      similarFunctionsCode:
        state.similarFunctionsCode || "// No context provided",
      parameters: state.parameters?.join(', ') || '',
      returnType: state.returnType || '',
      className: state.className || '',
      isMethod: state.isMethod || false,
      decorators: state.decorators?.join(', ') || ''
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[${new Date().toISOString()}] === LLM generation complete in ${duration}s ===`
    );
    console.log(`Generated ${generatedCode.length} characters of test code`);
    vscode.window.showInformationMessage(
      `Test generation complete in ${duration} seconds.`
    );

    return { generatedTestCode: generatedCode };
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] Error generating tests with LLM:`,
      error
    );
    vscode.window.showErrorMessage(`LLM generation failed: ${error.message}`);

    // Check for specific API key errors
    if (error.message && error.message.includes("api key")) {
      return {
        errorMessage: `LLM generation failed: Invalid OpenAI API Key or configuration issue.`,
      };
    }
    return { errorMessage: `LLM generation failed: ${error.message}` };
  }
}

/**
 * Finds and reads all related C files in the workspace for a given file.
 * @param baseFilePath The path of the original file
 * @returns Promise with an array of {path, content} objects for related C files
 */
async function findRelatedCFiles(
  baseFilePath: string
): Promise<Array<{ path: string; content: string }>> {
  try {
    // Get the directory of the base file
    const baseDir = path.dirname(baseFilePath);
    const baseFileName = path.basename(
      baseFilePath,
      path.extname(baseFilePath)
    );

    // Find all C files in the same directory and parent directory
    const relatedFiles: Array<{ path: string; content: string }> = [];

    // Get workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return relatedFiles;
    }

    // Search for C files
    const cFilePattern = new vscode.RelativePattern(baseDir, "*.{c,h}");
    const files = await vscode.workspace.findFiles(cFilePattern);

    // Add search in parent directory if it's still within the workspace
    const parentDir = path.dirname(baseDir);
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    if (parentDir.startsWith(workspaceRoot)) {
      const parentPattern = new vscode.RelativePattern(parentDir, "*.{c,h}");
      const parentFiles = await vscode.workspace.findFiles(parentPattern);
      files.push(...parentFiles);
    }

    // Include header files with matching names (often contain related functionality)
    const includePattern = new vscode.RelativePattern(
      workspaceFolders[0].uri.fsPath,
      `**/${baseFileName}.h`
    );
    const includeFiles = await vscode.workspace.findFiles(includePattern);
    files.push(...includeFiles);

    // Remove duplicates and the original file
    const uniqueFilePaths = [...new Set(files.map((f) => f.fsPath))].filter(
      (p) => p !== baseFilePath
    );

    // Read file contents
    for (const filePath of uniqueFilePaths) {
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        relatedFiles.push({
          path: filePath,
          content: document.getText(),
        });
      } catch (err) {
        console.warn(`Failed to read related file ${filePath}:`, err);
      }
    }

    console.log(`Found ${relatedFiles.length} related C files for context`);
    return relatedFiles;
  } catch (error) {
    console.error("Error finding related C files:", error);
    return [];
  }
}

// --- VS Code Extension Activation ---

// Keep track of the vector manager instance
let vectorManagerInstance: SimpleVectorManager | null = null;
// Track if LangSmith tracing is enabled
let langsmithTracingEnabled = false;

// Global variables for parsers and vector manager
let cParser: CParser | null = null;
let pythonParser: PythonParser | null = null;
let vectorManager: SimpleVectorManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, extension "rag-unit-testing" is now active!');

  // --- Initialization ---
  let vectorManager: SimpleVectorManager | null = null; // Initialize as null
  let cParser: CParser | null = null; // Initialize C parser
  let vectorDBAvailable = false; // Track if vector DB is available

  // Define the command handles outside any try/catch blocks
  let helloWorldDisposable: vscode.Disposable;
  let printVectorsDisposable: vscode.Disposable;
  let generateUnitTestDisposable: vscode.Disposable;
  let configureDisposable: vscode.Disposable;

  // Check if vector DB is disabled in settings
  const config = vscode.workspace.getConfiguration("rag-unit-testing");
  const vectorDBDisabled = config.get("disableVectorDB") === true;

  if (vectorDBDisabled) {
    console.log("Vector database functionality disabled by user configuration");
    vscode.window.showInformationMessage(
      "Running in LLM-only mode (Vector DB disabled in settings)"
    );
  } else {
    try {
      // Initialize the simple vector manager
      console.log("Using SimpleVectorManager for vector embeddings");
      vectorManager = new SimpleVectorManager();
      vectorManagerInstance = vectorManager; // Store for deactivate

      // Initialize asynchronously, don't block activation
      vectorManager
        .initialize()
        .then((initialized) => {
          vectorDBAvailable = initialized;
          if (initialized) {
            console.log(
              "SimpleVectorManager initialization successful (async)."
            );
          } else {
            console.error("SimpleVectorManager initialization failed (async).");
            vscode.window.showWarningMessage(
              "Vector database not available. The extension will work in reduced functionality mode without RAG context."
            );
          }
        })
        .catch((error) => {
          console.error(
            "Error during async SimpleVectorManager initialization:",
            error
          );
          vscode.window.showWarningMessage(
            "Vector database not available. The extension will work in reduced functionality mode without RAG context."
          );
          vectorManager = null; // Ensure it's null on error
        });
    } catch (error: any) {
      console.error("Failed to instantiate SimpleVectorManager:", error);
      vscode.window.showWarningMessage(
        `Unable to connect to vector database: ${error.message}. The extension will work in reduced functionality mode without RAG context.`
      );
      // vectorManager remains null
    }
  }

  // Initialize C parser - do this in parallel with vector DB initialization
  cParser = new CParser();
  cParser
    .initialize()
    .then((initialized) => {
      if (initialized) {
        console.log("C parser initialized successfully.");
      } else {
        console.warn(
          "C parser initialization failed, will use fallback regex parser."
        );
      }
    })
    .catch((error) => {
      console.error("Error initializing C parser:", error);
    });

  // Initialize Python parser - do this in parallel with C parser initialization
  pythonParser = new PythonParser();
  pythonParser
    .initialize()
    .then((initialized) => {
      if (initialized) {
        console.log("Python parser initialized successfully.");
      } else {
        console.warn(
          "Python parser initialization failed, will use fallback regex parser."
        );
      }
    })
    .catch((error) => {
      console.error("Error initializing Python parser:", error);
    });

  // Initialize LangSmith tracing if configured
  try {
    // Get configuration
    const config = vscode.workspace.getConfiguration("rag-unit-testing");

    // Check if LangSmith is enabled in settings
    const enableLangSmith = config.get("enableLangSmith") === true;

    // Get LangSmith settings - first check VS Code settings, then environment variables
    const langsmithApiKey =
      (config.get("langsmithApiKey") as string) ||
      process.env.LANGSMITH_API_KEY;
    const langsmithProject =
      (config.get("langsmithProject") as string) ||
      process.env.LANGSMITH_PROJECT ||
      "rag-unit-testing";
    const langsmithEndpoint =
      (config.get("langsmithEndpoint") as string) ||
      process.env.LANGSMITH_ENDPOINT ||
      "https://api.smith.langchain.com";

    // Check if tracing is enabled either via settings or environment variable
    langsmithTracingEnabled =
      enableLangSmith || process.env.LANGSMITH_TRACING === "true";

    if (langsmithApiKey) {
      console.log(
        `LangSmith API key found. Using project: ${langsmithProject}`
      );

      if (langsmithTracingEnabled) {
        console.log("LangSmith tracing is enabled");

        // Set environment variables for LangSmith - required for LangChain to use them
        process.env.LANGSMITH_API_KEY = langsmithApiKey;
        process.env.LANGSMITH_PROJECT = langsmithProject;
        process.env.LANGSMITH_ENDPOINT = langsmithEndpoint;
      } else {
        console.log("LangSmith tracing is disabled");
      }
    } else {
      console.log("LangSmith API key not found, tracing disabled");
      langsmithTracingEnabled = false;
    }
  } catch (error) {
    console.log("Error initializing LangSmith tracing:", error);
    langsmithTracingEnabled = false;
  }

  // --- LangGraph Workflow ---

  // Define node names as constants
  const RETRIEVE_CONTEXT = "retrieveContext";
  const GENERATE_TESTS = "generateTests";

  // Create StateGraph with explicit GraphState
  const workflow = new StateGraph<GraphState>({
    channels: {
      functionName: {
        value: (x?: string, y?: string): string => y ?? x ?? "",
        default: (): string => "",
      },
      functionCode: {
        value: (x?: string, y?: string): string => y ?? x ?? "",
        default: (): string => "",
      },
      filePath: {
        value: (x?: string, y?: string): string => y ?? x ?? "",
        default: (): string => "",
      },
      similarFunctionsCode: {
        value: (x?: string, y?: string): string | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      generatedTestCode: {
        value: (x?: string, y?: string): string | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      errorMessage: {
        value: (x?: string, y?: string): string | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      language: {
        value: (x?: 'c' | 'python', y?: 'c' | 'python'): 'c' | 'python' => y ?? x ?? 'c',
        default: (): 'c' => 'c',
      },
      className: {
        value: (x?: string, y?: string): string | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      isMethod: {
        value: (x?: boolean, y?: boolean): boolean | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      decorators: {
        value: (x?: string[], y?: string[]): string[] | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      parameters: {
        value: (x?: string[], y?: string[]): string[] | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
      returnType: {
        value: (x?: string, y?: string): string | undefined =>
          y !== undefined ? y : x,
        default: (): undefined => undefined,
      },
    },
    // Add LangSmith tracking configuration
    ...(langsmithTracingEnabled
      ? {
          tracingConfig: {
            projectName: process.env.LANGSMITH_PROJECT || "rag-unit-testing",
          },
        }
      : {}),
  });

  // Wrap node functions
  const retrieveContextNode = new RunnableLambda({
    func: async (state: GraphState): Promise<Partial<GraphState>> => {
      return retrieveContext(state, vectorManager);
    },
  });

  const generateTestsNode = new RunnableLambda({
    func: generateTests,
  });

  // Add nodes to the graph
  workflow.addNode(RETRIEVE_CONTEXT, retrieveContextNode);
  workflow.addNode(GENERATE_TESTS, generateTestsNode);

  try {
    // Define the workflow correctly using START constant and explicit type casts
    // Cast node names to the types LangGraph expects
    workflow.addEdge(START, RETRIEVE_CONTEXT as unknown as "__start__");
    workflow.addEdge(
      RETRIEVE_CONTEXT as unknown as "__start__",
      GENERATE_TESTS as unknown as "__start__"
    );
    workflow.addEdge(GENERATE_TESTS as unknown as "__start__", END);

    // Compile the graph
    const app = workflow.compile();
    console.log("LangGraph workflow compiled successfully.");

    if (langsmithTracingEnabled) {
      console.log("LangGraph workflow will be traced in LangSmith");
    }

    // --- Command Registrations ---

    // Simple Hello World command (example)
    helloWorldDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.helloWorld",
      () => {
        vscode.window.showInformationMessage(
          "Hello World from RAG Unit Testing!"
        );
      }
    );

    // Command to print vector embeddings (debugging)
    printVectorsDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.printVectorEmbeddings",
      async () => {
        // Check if manager is initialized before proceeding
        if (!vectorManager || !(await vectorManager.initialize())) {
          vscode.window.showErrorMessage(
            "Vector DB is not available or failed to initialize. Cannot print embeddings."
          );
          return;
        }
        try {
          const functionName = await vscode.window.showInputBox({
            prompt: "Enter function name to print vector embeddings",
            placeHolder: "e.g., calculate_sum",
          });
          if (!functionName) return; // User cancelled

          // Await the print operation
          await vectorManager.printVectorEmbeddingsForFunctions(functionName);
          vscode.window.showInformationMessage(
            `Vector embeddings search for "${functionName}" initiated. Check Debug Console (Ctrl+Shift+Y).`
          );
        } catch (error: any) {
          console.error("Error in printVectorEmbeddings command:", error);
          vscode.window.showErrorMessage(
            `Failed to print vector embeddings: ${error.message}`
          );
        }
      }
    );

    // Command to generate unit tests using LangGraph
    generateUnitTestDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.generateUnitTest",
      async (uri?: vscode.Uri) => {
        // Allow command palette invocation (uri might be undefined)
        let targetUri = uri;

        // If command is run from palette, try to get active editor's URI
        if (!targetUri && vscode.window.activeTextEditor) {
          targetUri = vscode.window.activeTextEditor.document.uri;
        }

        if (!targetUri) {
          vscode.window.showErrorMessage(
            "No file selected or active editor found. Please right-click a C or Python file or open it."
          );
          return;
        }

        // Ensure it's a C or Python file (basic check)
        if (!targetUri.fsPath.match(/\.(c|h|py)$/i)) {
          vscode.window.showWarningMessage(
            "Please select a C source file (.c or .h) or Python file (.py)."
          );
          return;
        }

        // Check if the vector database is available
        const vectorDBAvailable = vectorManager && vectorManager.isReady();
        const config = vscode.workspace.getConfiguration("rag-unit-testing");
        const vectorDBDisabled = config.get("disableVectorDB") === true;

        // Ensure the compiled graph 'app' is available
        if (!app) {
          vscode.window.showErrorMessage(
            "LangGraph application failed to compile. Cannot generate tests."
          );
          return;
        }

        try {
          const document = await vscode.workspace.openTextDocument(targetUri);
          const fileContent = document.getText();
          const filePath = document.fileName;
          const fileExtension = path.extname(filePath).toLowerCase();

          // 1. Store/Update context in Weaviate (only if vector DB is available and not disabled)
          if (vectorDBAvailable && !vectorDBDisabled) {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "Analyzing function context...",
                cancellable: false,
              },
              async (progress) => {
                progress.report({
                  increment: 20,
                  message: "Storing file context in Vector DB...",
                });
                if (vectorManager) {
                  await vectorManager.storeFileContext(filePath, fileContent);
                  progress.report({
                    increment: 30,
                    message: "Context stored.",
                  });
                } else {
                  progress.report({
                    increment: 30,
                    message: "Context storage skipped (DB not ready).",
                  });
                  throw new Error("Vector DB context could not be stored.");
                }
              }
            );
          }

          // 2. Extract all functions from the file
          let parsedFunctions: ParsedFunction[] = [];
          
          if (fileExtension === '.py') {
            // For Python files, use the Python parser
            if (pythonParser && (await pythonParser.initialize())) {
              console.log("Using Python parser to find functions");
              const parsedFile = pythonParser.parseContent(fileContent, filePath);
              parsedFunctions = parsedFile.elements
                .filter((element: PythonCodeElement) => element.type === 'function' || element.type === 'method')
                .map((element: PythonCodeElement) => ({
                  functionName: element.name,
                  content: element.content,
                  parameters: element.parameters || [],
                  returnType: element.returnType || '',
                  className: element.parentClass,
                  isMethod: element.type === 'method',
                  decorators: element.decorators
                }));
            } else {
              // Fallback to regex parser for Python
              console.log("Falling back to regex parser for Python");
              parsedFunctions = parsePythonFunctions(fileContent);
            }
          } else {
            // For C files, use the C parser
            if (cParser && (await cParser.initialize())) {
              console.log("Using Tree-sitter parser to find functions");
              parsedFunctions = cParser.parseFunctions(fileContent, filePath);
            } else {
              // Fallback to regex parser for C
              console.log("Falling back to regex parser for C");
              parsedFunctions = parseCFunctions(fileContent);
            }
          }

          // Filter out 'main' function
          parsedFunctions = parsedFunctions.filter(f => f.functionName !== 'main');

          if (parsedFunctions.length === 0) {
            vscode.window.showErrorMessage("No functions found in the file to test.");
            return;
          }

          // 3. Let user select which functions to test
          const functionItems = parsedFunctions.map(f => ({
            label: f.functionName,
            description: `${f.returnType || 'void'} ${f.functionName}(${f.parameters.join(', ')})`,
            function: f,
            picked: true // Default to selected
          }));

          const selectedFunctions = await vscode.window.showQuickPick(functionItems, {
            placeHolder: "Select functions to generate tests for (use space to toggle)",
            matchOnDescription: true,
            canPickMany: true // Enable multi-select
          });

          if (!selectedFunctions || selectedFunctions.length === 0) {
            vscode.window.showInformationMessage("No functions selected. Test generation cancelled.");
            return;
          }

          // 4. Generate tests for selected functions
          let allTestCode = '';
          
          // Show progress for the selected functions
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Generating tests for ${selectedFunctions.length} functions...`,
              cancellable: true
            },
            async (progress, token) => {
              token.onCancellationRequested(() => {
                vscode.window.showInformationMessage(`Test generation cancelled`);
              });

              try {
                // Process each selected function
                for (let i = 0; i < selectedFunctions.length; i++) {
                  const functionData = selectedFunctions[i].function;
                  progress.report({
                    increment: (100 / selectedFunctions.length),
                    message: `Processing function ${i+1}/${selectedFunctions.length}: ${functionData.functionName}`
                  });

                  // Create the initial state for this function
                  const initialState: GraphState = {
                    functionName: functionData.functionName,
                    functionCode: functionData.content,
                    filePath,
                    language: fileExtension === '.py' ? 'python' : 'c',
                    parameters: functionData.parameters,
                    returnType: functionData.returnType,
                    className: functionData.className,
                    isMethod: functionData.isMethod,
                    decorators: functionData.decorators
                  };

                  // Execute the graph for this function
                  const result = await app.invoke(initialState);

                  if (result.errorMessage) {
                    console.error(`Error generating test for ${functionData.functionName}: ${result.errorMessage}`);
                    continue; // Skip this function but continue with others
                  }

                  if (!result.generatedTestCode) {
                    console.error(`No test code generated for ${functionData.functionName}`);
                    continue; // Skip this function but continue with others
                  }

                  // Add a separator between function tests
                  if (allTestCode) {
                    allTestCode += '\n\n// ===== Tests for next function =====\n\n';
                  }

                  // Add the test code for this function
                  allTestCode += result.generatedTestCode;
                }

                // Create the test file
                const testFileName = `test_${path.basename(filePath, fileExtension)}.${fileExtension === '.py' ? 'py' : 'c'}`;
                const testFilePath = path.join(path.dirname(filePath), testFileName);

                // Add debug logging
                console.log(`Attempting to create test file at: ${testFilePath}`);

                try {
                  // Ensure the directory exists
                  await fs.mkdir(path.dirname(testFilePath), { recursive: true });
                  
                  // Write the test file with explicit encoding
                  await fs.writeFile(testFilePath, allTestCode, 'utf8');
                  
                  // Verify the file was created
                  const fileExists = await fs.access(testFilePath)
                    .then(() => true)
                    .catch(() => false);
                    
                  if (!fileExists) {
                    throw new Error(`Failed to create test file at ${testFilePath}`);
                  }
                  
                  // Open the test file in the editor
                  const testFileUri = vscode.Uri.file(testFilePath);
                  const doc = await vscode.workspace.openTextDocument(testFileUri);
                  await vscode.window.showTextDocument(doc);
                  
                  vscode.window.showInformationMessage(
                    `Generated tests for ${selectedFunctions.length} functions in ${testFileName}`
                  );
                } catch (error: any) {
                  console.error(`Error writing test file: ${error.message}`);
                  vscode.window.showErrorMessage(
                    `Failed to create test file: ${error.message}\nPath: ${testFilePath}`
                  );
                }
              } catch (error: any) {
                vscode.window.showErrorMessage(
                  `Failed to generate tests: ${error.message}`
                );
              }
            }
          );

        } catch (error: any) {
          console.error("Error in generateUnitTest command:", error);
          vscode.window.showErrorMessage(
            `Failed to generate unit tests: ${error.message}`
          );
        }
      }
    );

    // Add command to configure API keys
    configureDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.configure",
      async () => {
        const options = [
          "Set OpenAI API Key",
          "Set LangSmith API Key",
          "Enable/Disable LangSmith Tracing",
          "Set LangSmith Project",
          "Open Settings in Editor",
        ];

        const selectedOption = await vscode.window.showQuickPick(options, {
          placeHolder: "Select a configuration option",
        });

        if (!selectedOption) {
          return; // User cancelled
        }

        const config = vscode.workspace.getConfiguration("rag-unit-testing");

        if (selectedOption === "Open Settings in Editor") {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "rag-unit-testing"
          );
          return;
        }

        if (selectedOption === "Set OpenAI API Key") {
          const prompt = "Enter your OpenAI API Key";
          const placeholder = "sk-...";
          const password = true;

          const value = await vscode.window.showInputBox({
            prompt,
            placeHolder: placeholder,
            password,
          });

          if (value !== undefined) {
            await config.update(
              "openaiApiKey",
              value,
              vscode.ConfigurationTarget.Global
            );
            vscode.window.showInformationMessage(
              "OpenAI API Key has been updated"
            );
          }
        }

        if (selectedOption === "Set LangSmith API Key") {
          const prompt = "Enter your LangSmith API Key";
          const placeholder = "lsv2_...";
          const password = true;

          const value = await vscode.window.showInputBox({
            prompt,
            placeHolder: placeholder,
            password,
          });

          if (value !== undefined) {
            await config.update(
              "langsmithApiKey",
              value,
              vscode.ConfigurationTarget.Global
            );
            vscode.window.showInformationMessage(
              "LangSmith API Key has been updated"
            );
          }
        }

        if (selectedOption === "Enable/Disable LangSmith Tracing") {
          const currentValue = config.get("enableLangSmith") === true;
          const options = [
            { label: "Enable", picked: currentValue },
            { label: "Disable", picked: !currentValue },
          ];

          const selection = await vscode.window.showQuickPick(options, {
            placeHolder: "Enable or disable LangSmith tracing",
            canPickMany: false,
          });

          if (selection) {
            const newValue = selection.label === "Enable";
            await config.update(
              "enableLangSmith",
              newValue,
              vscode.ConfigurationTarget.Global
            );
            vscode.window.showInformationMessage(
              `LangSmith tracing has been ${newValue ? "enabled" : "disabled"}`
            );
          }
        }

        if (selectedOption === "Set LangSmith Project") {
          const currentValue =
            (config.get("langsmithProject") as string) || "rag-unit-testing";
          const prompt = "Enter your LangSmith project name";
          const placeholder = currentValue;

          const value = await vscode.window.showInputBox({
            prompt,
            placeHolder: placeholder,
            value: currentValue,
          });

          if (value !== undefined) {
            await config.update(
              "langsmithProject",
              value,
              vscode.ConfigurationTarget.Global
            );
            vscode.window.showInformationMessage(
              "LangSmith project has been updated"
            );
          }
        }
      }
    );
  } catch (graphError: any) {
    console.error("Error setting up LangGraph workflow:", graphError);
    vscode.window.showErrorMessage(
      `Failed to set up LangGraph workflow: ${graphError.message}`
    );
    // Continue with command registration anyway, so basic commands still work

    // Register just the basic commands
    helloWorldDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.helloWorld",
      () => {
        vscode.window.showInformationMessage(
          "Hello World from RAG Unit Testing!"
        );
      }
    );

    const printVectorsDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.printVectorEmbeddings",
      async () => {
        vscode.window.showErrorMessage(
          "Feature unavailable due to graph initialization failure."
        );
      }
    );

    const generateUnitTestDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.generateUnitTest",
      async () => {
        vscode.window.showErrorMessage(
          "Cannot generate tests due to LangGraph initialization failure."
        );
      }
    );

    // Add these fallback disposables to context
    context.subscriptions.push(
      helloWorldDisposable,
      printVectorsDisposable,
      generateUnitTestDisposable
    );

    return; // Exit activation
  }

  // Add disposables to context subscriptions
  context.subscriptions.push(
    helloWorldDisposable,
    printVectorsDisposable,
    generateUnitTestDisposable,
    configureDisposable
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log('Extension "rag-unit-testing" is now deactivated.');

  // Clean up resources
  if (vectorManagerInstance) {
    try {
      console.log("Disposing vector manager resources...");
      vectorManagerInstance.dispose();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }
}

// Helper function to parse C functions (ensure this is robust or replaced)
function parseCFunctions(fileContent: string): Array<{
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
}> {
  console.warn("Using enhanced regex parseCFunctions in extension.ts.");
  const functions: Array<{
    functionName: string;
    content: string;
    parameters: string[];
    returnType: string;
  }> = [];

  // Remove comments first to simplify parsing
  const contentWithoutComments = fileContent
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments /* ... */
    .replace(/\/\/.*$/gm, ""); // Remove single-line comments // ...

  // First try with a more relaxed pattern that can handle more function styles
  const functionRegex =
    /(?:^|\n)([a-zA-Z_][\w\s\*]+?)[\s\n]+([a-zA-Z_]\w*)[\s\n]*\(([^)]*)\)[\s\n]*(?:;|\{([\s\S]*?)(?:^|\n)\s*\})/gm;

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
    const content = match[0].trim(); // Full match including signature and body

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

    // Check if we already have this function (avoid duplicates)
    if (!functions.some((f) => f.functionName === functionName)) {
      functions.push({
        functionName,
        content,
        parameters,
        returnType,
      });
    }
  }

  // Try to catch functions with macro definitions in their return type
  if (functions.length === 0) {
    // Second pass with a more relaxed pattern
    const relaxedFunctionRegex =
      /(?:^|\n)([\w\s\*]+?)[\s\n]+([a-zA-Z_]\w*)[\s\n]*\(([^)]*)\)[\s\n]*\{([\s\S]*?)(?:^|\n)\s*\}/gm;

    while (
      (match = relaxedFunctionRegex.exec(contentWithoutComments)) !== null
    ) {
      const returnType = match[1].trim().replace(/\s+/g, " ");
      const functionName = match[2].trim();
      const paramsString = match[3].trim();
      const content = match[0].trim();

      // Skip already found functions and main
      if (
        functionName === "main" ||
        functions.some((f) => f.functionName === functionName)
      ) {
        continue;
      }

      const parameters = paramsString
        ? paramsString
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p !== "void" && p !== "")
        : [];

      functions.push({
        functionName,
        content,
        parameters,
        returnType,
      });
    }
  }

  console.log(`Parser found ${functions.length} function definitions.`);
  return functions;
}
// Note: This is a basic parser and may not handle all C syntax correctly.
// For production, consider using a more robust parser (e.g., tree-sitter) or a library that can handle C syntax accurately.
// Note: Ensure to handle edge cases and test thoroughly with various C code samples.

// Function to parse Python functions using regex (fallback method)
function parsePythonFunctions(content: string): ParsedFunction[] {
  const functions: ParsedFunction[] = [];
  const lines = content.split('\n');
  
  // Regular expression for Python function definitions
  const functionRegex = /^def\s+(\w+)\s*\(/;
  
  let currentFunction: { name: string; startLine: number } | undefined;
  let functionLines: string[] = [];
  let indentationLevel = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      if (currentFunction) {
        functionLines.push(line);
      }
      continue;
    }
    
    // Check for function definition
    const functionMatch = trimmedLine.match(functionRegex);
    if (functionMatch) {
      // Save previous function if exists
      if (currentFunction) {
        functions.push({
          functionName: currentFunction.name,
          content: functionLines.join('\n'),
          parameters: [],
          returnType: ''
        });
      }
      
      // Start new function
      currentFunction = {
        name: functionMatch[1],
        startLine: i
      };
      functionLines = [line];
      indentationLevel = line.search(/\S/);
    } else if (currentFunction) {
      // Check if we're still in the function
      const currentIndentation = line.search(/\S/);
      if (currentIndentation > indentationLevel) {
        functionLines.push(line);
      } else {
        // Function ended
        functions.push({
          functionName: currentFunction.name,
          content: functionLines.join('\n'),
          parameters: [],
          returnType: ''
        });
        currentFunction = undefined;
        functionLines = [];
      }
    }
  }
  
  // Add the last function if exists
  if (currentFunction) {
    functions.push({
      functionName: currentFunction.name,
      content: functionLines.join('\n'),
      parameters: [],
      returnType: ''
    });
  }
  
  return functions;
}