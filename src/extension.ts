// Import necessary VS Code and Node.js modules
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises"; // Use promises for async file operations

// Import local modules
import { SimpleVectorManager } from "./simple-vector"; // Import our simple vector manager
import { CParser } from "./c-parser"; // Import our advanced C parser

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

// --- LangGraph Setup ---

// Define the state interface for the graph
interface GraphState {
  functionName: string; // Name of the function to test
  functionCode: string; // Source code of the function to test
  filePath: string; // Path to the source file
  similarFunctionsCode?: string; // Code of similar functions (context)
  generatedTestCode?: string; // The final generated unit test code
  errorMessage?: string; // To capture errors during graph execution
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
  console.log(
    `[${new Date().toISOString()}] --- Node: generateTests starting ---`
  );
  if (!state.functionCode) {
    console.error("Function code is missing, cannot generate tests.");
    return { errorMessage: "Function code is missing, cannot generate tests." };
  }

  // Get OpenAI API key from VS Code settings or environment variables
  const config = vscode.workspace.getConfiguration("rag-unit-testing");
  const openaiApiKey =
    (config.get("openaiApiKey") as string) || process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.error(
      "OpenAI API key is not configured in either VS Code settings or environment variables."
    );
    return {
      errorMessage:
        "OpenAI API key is not configured in either VS Code settings or environment variables.",
    };
  }

  console.log(
    `[${new Date().toISOString()}] OpenAI API key found (length: ${
      openaiApiKey.length
    })`
  );
  console.log(
    `[${new Date().toISOString()}] Creating LLM instance with model: gpt-4o-mini`
  );

  try {
    const llm = new ChatOpenAI({
      modelName: "gpt-4o-mini", // Or your preferred model
      temperature: 0.3,
      apiKey: openaiApiKey,
    });

    console.log(
      `[${new Date().toISOString()}] LLM initialized, preparing prompt template`
    );

    const testGenPrompt = PromptTemplate.fromTemplate(
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
    },
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
            "No file selected or active editor found. Please right-click a C file or open it."
          );
          return;
        }

        // Ensure it's a C file (basic check)
        if (!targetUri.fsPath.match(/\.(c|h)$/i)) {
          vscode.window.showWarningMessage(
            "Please select a C source file (.c or .h)."
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

          // 1. Store/Update context in Weaviate (only if vector DB is available and not disabled)
          if (vectorDBAvailable && !vectorDBDisabled) {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "Analyzing function context...",
                cancellable: false, // Keep false if storeFileContext cannot be cancelled
              },
              async (progress) => {
                progress.report({
                  increment: 20,
                  message: "Storing file context in Vector DB...",
                });
                // Ensure vectorManager is not null before calling
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
                  // Optionally throw an error or handle this case
                  throw new Error("Vector DB context could not be stored.");
                }
              }
            );
          } else {
            console.log(
              "Skipping vector DB context storage (DB not available or disabled)"
            );
          }

          // 2. Extract function name
          const functionMatch = fileContent.match(
            /^\s*(?:[\w\s\*]+?)\s+(\w+)\s*\(/m
          );
          let functionName = functionMatch ? functionMatch[1] : undefined;

          if (!functionName || functionName === "main") {
            functionName = await vscode.window.showInputBox({
              prompt:
                "Could not auto-detect function. Enter the function name to test:",
              placeHolder: "e.g., calculate_sum",
              value:
                functionName && functionName !== "main" ? functionName : "", // Pre-fill if partially detected
            });
          }

          if (!functionName) {
            vscode.window.showErrorMessage(
              "No function name provided. Aborting test generation."
            );
            return;
          }

          // 3. Find the specific code block for the target function
          let targetFunction = null;
          let parsedFunctions = [];

          // Try using Tree-sitter parser first
          if (cParser && (await cParser.initialize())) {
            console.log("Using Tree-sitter parser to find functions");
            parsedFunctions = cParser.parseFunctions(fileContent, filePath);
            targetFunction = parsedFunctions.find(
              (f) => f.functionName === functionName
            );
          }

          // Fall back to regex parser if needed
          if (!targetFunction) {
            console.log("Falling back to regex parser");
            if (cParser) {
              // Use the fallback method from the C parser
              parsedFunctions = cParser.fallbackParseFunctions(fileContent);
            } else {
              // Use the original regex parser as final fallback
              parsedFunctions = parseCFunctions(fileContent);
            }
            targetFunction = parsedFunctions.find(
              (f) => f.functionName === functionName
            );
          }

          let functionCode = "";

          if (!targetFunction) {
            console.warn(
              `Function '${functionName}' not found in parsed content of ${path.basename(
                filePath
              )}.`
            );
            vscode.window.showWarningMessage(
              `Function '${functionName}' could not be found automatically. Continuing with user input.`
            );

            // Allow user to input function code directly if not found
            const userProvidedCode = await vscode.window.showInputBox({
              prompt: `Couldn't locate function '${functionName}'. Please provide a description or signature:`,
              placeHolder: "void function(int param1, char* param2) {...}",
              ignoreFocusOut: true,
              validateInput: (text) => {
                return text.length > 0
                  ? null
                  : "Please enter a function description or click Cancel";
              },
            });

            if (!userProvidedCode) {
              vscode.window.showErrorMessage("Test generation cancelled.");
              return;
            }

            functionCode = userProvidedCode;
          } else {
            functionCode = targetFunction.content;
          }

          // Gather context from related files
          let additionalContext = "";
          const relatedFiles = await findRelatedCFiles(filePath);

          if (relatedFiles.length > 0) {
            // Process and store context from related files
            vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "Processing related files for context...",
                cancellable: false,
              },
              async (progress) => {
                progress.report({ increment: 0 });

                let processedCount = 0;
                for (const relatedFile of relatedFiles) {
                  try {
                    // Store in vector DB if available
                    if (
                      vectorManager &&
                      vectorManager.isReady() &&
                      !vectorDBDisabled
                    ) {
                      await vectorManager.storeFileContext(
                        relatedFile.path,
                        relatedFile.content
                      );
                    }

                    // Parse functions to extract for direct context
                    const fileFunctions = parseCFunctions(relatedFile.content);
                    if (fileFunctions.length > 0) {
                      const fileBaseName = path.basename(relatedFile.path);
                      additionalContext += `\n// Functions from ${fileBaseName}:\n`;
                      fileFunctions.forEach((f) => {
                        additionalContext += `\n${f.content}\n`;
                      });
                    }

                    processedCount++;
                    progress.report({
                      increment: (processedCount / relatedFiles.length) * 100,
                      message: `Processed ${processedCount}/${relatedFiles.length} files`,
                    });
                  } catch (err) {
                    console.warn(
                      `Error processing related file ${relatedFile.path}:`,
                      err
                    );
                  }
                }

                console.log(
                  `Added ${additionalContext.length} chars of context from related files`
                );
              }
            );
          }

          // 4. Prepare initial state for LangGraph
          const initialState: GraphState = {
            functionName: functionName,
            functionCode: functionCode,
            filePath: filePath,
            // If there's additional context and we don't use vector DB, provide it directly
            similarFunctionsCode: vectorDBAvailable
              ? undefined
              : additionalContext,
            generatedTestCode: undefined,
            errorMessage: undefined,
          };

          // 5. Invoke LangGraph workflow with Progress Indicator
          let cancelled = false; // Flag for cancellation

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Generating tests for ${functionName}...`,
              cancellable: true, // Allow cancellation
            },
            async (progress, token) => {
              progress.report({
                increment: 0,
                message: "Starting workflow...",
              });

              // Cancellation handling setup
              token.onCancellationRequested(() => {
                console.log("Test generation cancelled by user.");
                cancelled = true;
                // Note: LangGraph invoke doesn't have built-in cancellation propagation yet.
                // The promise will likely still resolve, but we'll check the 'cancelled' flag.
              });

              try {
                // Invoke the graph
                const result = await app.invoke(initialState, {
                  recursionLimit: 10,
                });

                // Check cancellation flag immediately after invoke returns
                if (cancelled) {
                  vscode.window.showInformationMessage(
                    "Test generation cancelled."
                  );
                  return; // Exit the progress block
                }

                // Type-safe way to handle the results
                // Force typecasting result to any since it has graph-specific properties
                const apiResult = result as any;

                // Safely extract generatedTestCode
                const testCode: string | undefined =
                  apiResult?.generatedTestCode;

                // Check if we have valid test code
                if (!testCode || typeof testCode !== "string") {
                  throw new Error(
                    "Graph execution didn't produce valid test code output"
                  );
                }

                // We have valid testCode at this point
                console.log("Test generation complete. Creating test file...");

                // Create and write the test file using extracted test code
                // Get original filename without extension
                const originalFilename = path.basename(
                  targetUri.fsPath,
                  path.extname(targetUri.fsPath)
                );
                const testFileName = `test${originalFilename}.c`;
                const testFileUri = vscode.Uri.joinPath(
                  targetUri,
                  "..",
                  testFileName
                );

                // Buffer.from with string (we know testCode is a string at this point)
                await fs.writeFile(testFileUri.fsPath, Buffer.from(testCode));

                const doc = await vscode.workspace.openTextDocument(
                  testFileUri
                );
                await vscode.window.showTextDocument(doc);

                vscode.window.showInformationMessage(
                  `Generated unit test file: ${testFileName}`
                );
              } catch (error: any) {
                console.error("Error during LangGraph invocation:", error);
                vscode.window.showErrorMessage(
                  `Error generating unit tests: ${error.message}`
                );
              }
            }
          );
        } catch (error: any) {
          // Catch errors from file operations, graph invocation, etc.
          console.error("Error in generateUnitTest command:", error);
          // Avoid showing 'Cancelled' as an error message if it was handled
          if (error.message !== "Cancelled") {
            const message =
              error.message.startsWith("Graph execution failed:") ||
              error.message.includes("LLM generation failed")
                ? error.message // Show specific graph/LLM errors directly
                : `Error generating unit test: ${
                    error.message || "Unknown error"
                  }`;
            vscode.window.showErrorMessage(message);
          }
        }
      }
    );

    // Add command to configure API keys
    configureDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.configure",
      async () => {
        const options = ["Set OpenAI API Key", "Open Settings in Editor"];

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
