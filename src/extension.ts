// Import necessary VS Code and Node.js modules
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises"; // Use promises for async file operations

// Import local modules
import { SimpleVectorManager } from "./simple-vector"; // Import our simple vector manager
import { CParser } from "./c-parser"; // Import our advanced C parser
import { TITestIntegrator } from "./ti-test-integrator"; // Import TI test integrator
import { TestCaseValidator } from "./test-validator";
import { PythonTestGenerator } from "./python-test-generator"; // Import the Python test generator

// Import LangChain and LangGraph components
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser, JsonOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  StateGraph,
  END,
  START,
  CompiledStateGraph,
  StateDefinition,
  StateGraphArgs,
} from "@langchain/langgraph"; // Import START constant explicitly
import {
  Runnable,
  RunnableLambda,
  RunnablePassthrough,
} from "@langchain/core/runnables";

// Add LangSmith imports
import { Client } from "langsmith";
import { LangChainTracer } from "langchain/callbacks";

// --- LangGraph Setup ---

// Define the state interface for the graph
interface GraphState {
  functions: Array<{
    functionName: string; // Name of the function to test
    functionCode: string; // Source code of the function to test
  }>;
  filePath: string; // Path to the source file
  similarFunctionsCode?: string; // Code of similar functions (context)
  generatedTestCode?: string; // The final consolidated generated unit test code
  errorMessage?: string; // To capture errors during graph execution
}

// Define the graph nodes

/**
 * Node: Retrieves context (similar functions) from the vector database.
 */
async function retrieveContext(
  state: GraphState,
  vectorManager: SimpleVectorManager | null,
  tiTestIntegrator: TITestIntegrator | null
): Promise<Partial<GraphState>> {
  console.log(`[${new Date().toISOString()}] --- Node: retrieveContext ---`);
  
  if (!state.functions || state.functions.length === 0) {
    return {
      errorMessage: "No functions provided to retrieve context for",
      similarFunctionsCode: "// No functions provided for context retrieval"
    };
  }
  
  // Use the first function as the primary context source
  const primaryFunction = state.functions[0];
  let contextResult = "";
  
  // Focus on TI test examples exclusively
  if (tiTestIntegrator && tiTestIntegrator.isReady()) {
    try {
      // Try to detect driver type from function code or path
      let driverName: string | undefined;
      if (state.filePath) {
        const fileName = path.basename(state.filePath).toLowerCase();
        // Try to extract driver name from filename
        if (fileName.includes("adc")) driverName = "adcbuf";
        else if (fileName.includes("gpio")) driverName = "gpio";
        else if (fileName.includes("uart")) driverName = "uart";
        else if (fileName.includes("nvs")) driverName = "nvs";
        else if (fileName.includes("i2c")) driverName = "i2c";
        else if (fileName.includes("spi")) driverName = "spi";
        else if (fileName.includes("timer")) driverName = "timer";
        else if (fileName.includes("watchdog")) driverName = "watchdog";
        // Add more mappings as needed
      }
      
      // Find relevant TI examples
      const tiExamples = await tiTestIntegrator.findRelevantExamples(
        primaryFunction.functionCode,
        driverName
      );
      
      if (tiExamples.length > 0) {
        console.log(`Found ${tiExamples.length} relevant TI test examples`);
        
        // Extract TI testing patterns for the driver
        if (driverName) {
          const patterns = await tiTestIntegrator.extractTITestingPatterns(driverName);
          contextResult += patterns + "\n\n";
        }
        
        // Add the most relevant test examples
        contextResult += "# Relevant TI Test Examples\n\n";
        
        // Include more TI examples for better context
        for (const example of tiExamples.slice(0, 3)) { // Include top 3 examples
          contextResult += `## ${path.basename(example.filePath)}\n`;
          contextResult += `Driver: ${example.metadata.driver}\n`;
          contextResult += `Board: ${example.metadata.boardSupport.join(", ")}\n`;
          contextResult += "```c\n";
          contextResult += example.content.substring(0, 3000) + (example.content.length > 3000 ? "...\n" : "\n");
          contextResult += "```\n\n";
        }
        
        return { similarFunctionsCode: contextResult };
      } else {
        console.log("No relevant TI test examples found, looking for generic test patterns");
        
        // Try to get generic test patterns for drivers
        if (driverName) {
          try {
            const genericPatterns = await tiTestIntegrator.extractTITestingPatterns(driverName);
            if (genericPatterns) {
              contextResult = "# Generic TI Testing Patterns\n\n" + genericPatterns;
              return { similarFunctionsCode: contextResult };
            }
          } catch (error) {
            console.error("Error getting generic test patterns:", error);
          }
        }
      }
    } catch (error) {
      console.error("Error retrieving TI test examples:", error);
    }
  }
  
  // Skip looking up regular vector database similar functions
  console.log("Focusing exclusively on TI engineer test cases and patterns");
  return {
    similarFunctionsCode: contextResult || 
      "// Generating tests based on TI engineering best practices without additional context.",
  };
}

/**
 * Node: Generates unit test code using an LLM.
 */
async function generateTests(state: GraphState): Promise<Partial<GraphState>> {
  console.log(
    `[${new Date().toISOString()}] --- Node: generateTests starting ---`
  );
  
  if (!state.functions || state.functions.length === 0) {
    console.error("No functions provided, cannot generate tests.");
    return { errorMessage: "No functions provided, cannot generate tests." };
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

    // Enable LangSmith tracing for the LLM if configured
    if (langsmithTracingEnabled && process.env.LANGSMITH_API_KEY) {
      console.log("Adding LangSmith tracing to LLM");
      const tracer = new LangChainTracer({
        projectName: process.env.LANGSMITH_PROJECT || "rag-unit-testing",
        client: new Client({
          apiKey: process.env.LANGSMITH_API_KEY,
          apiUrl:
            process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
        }),
      });

      // Add tracer to LLM callbacks
      llm.callbacks = [tracer];
    }

    console.log(
      `[${new Date().toISOString()}] LLM initialized, preparing prompt template`
    );

    const summariesPrompt = PromptTemplate.fromTemplate(
      `Based on the following file, list all methods in JSON format as the following:
       {json_format}
      The description should include information such as:
      - Comments
      - Related functions
      - What the function returns (not just the return type, but a description of what the return value is)
      - Extra context and assumptions

      {file_contents}
`,
      {
        partialVariables: {
          "json_format": `
            export interface FunctionInfo {
              [name: string]: {
                description: string;
                returnType: string;
                parameters: Record<string, { description: string; type: string }>;
              };
            }
        `,
        },
      },
    );

    const testableFunctionsPrompt = PromptTemplate.fromTemplate(
      `Given the following function summaries, return them as an array. Only output a raw, parsable JSON stringified array, with no additional formatting, markdown, or code block syntax.
    Do not enclose the output in triple backticks or any other delimiters. Omit any utility functions or functions that are not testable.

    File_contents: {file_contents}`,
    );
    // Explore good/bad conditions for each testable function.
    const exploreConditionsPrompt = PromptTemplate.fromTemplate(
      `
        Given a list of testable functions and the source code for each, explore testable conditions (e.g. expected return valve, if statements, loops, etc.) for each function.
        Always consider these conditions: 
        - What if the function is partially successful (i.e. what if a read completes halfway?)
        - What if the function completely fails? 

        Go through all possible parameters, including edge cases. What happens if parameter A is null? What happens if parameter B is valid but does not exist in the database?
        For example:
        fn read_and_sum(file_A, file_B, offset_A, offset_B):
        - What if file_A/file_B is null?
        - What if offset_A/offset_B is a negative number?
        - What if everything is valid but A or B are greater than the file size?
        - What if a read is successful but the sum exceeds the max value of an int?
        - What if the read fails?
        - What if the read valud value is not an int?

        You MUST include ALL POSSIBLE CONDITIONS and ALL POSSIBLE PARAMETERS. DO NOT ASSUME that the a success or failure condition can cover other conditions.
        You should also include any other conditions that you think are important to test.

        Output the result in JSON format where the keys are the function names and the values the list of conditions as a paragraph description.
        The description should include information such as:
        - Whether the condition is a success or failure condition
        - What the condition is checking for
        - What the condition is doing
        - Any other relevant information

        Example output:
        {{
          "function_name": [
            "condition_1 is a success condition that checks for X and does Y. The return value should be Z",
            "condition_2 is a failure condition that checks for A and does B. The return value should be C",
            "condition_3 is a condition that checks for D if paremter E is F and does G. The return value should be H",
            "condition_4 is a condition that checks for I if parameter J is K and does L. The return value should be M",
          ]
        }}

        Only output a raw, parsable JSON string, with no additional formatting, markdown, or code block syntax.
        Do not enclose the output in triple backticks or any other delimiters.

        Testable functions: {function}
        Source code: {file_contents}`,
    );

    const testGeneratorPrompt = PromptTemplate.fromTemplate(
      `
    Given the following instructions on generating tests, the conditions your test should explore, and the source code generate a test for {function_name}.

    You should follow TI's testing style which includes:
    1. Device-family handling with #if defined(DeviceFamily_...) and ti_drivers_config.h
    2. Utility functions like isSectorErased() and isSectorProgrammed() to verify flash contents
    3. Parameterized test functions with thin zero-arg wrappers for Unity
    4. Explicit test runner that lists all tests
    5. Rich assertion messages with every TEST_ASSERT
    6. Proper BSD-style license header

    For each condition, create a initialize -> call -> validate pattern within the test function. Always comment beforehand to clarify your intent.
    The test should be in the style of Unity tests, which are used for testing embedded systems. The tests should be written in C and follow the Unity test framework conventions.
    Test functions should be named test_<module_name>_<function_name>.
    DO NOT CREATE MOCKS, tests are run on real hardware.

    Only output a raw C code, with no additional formatting, markdown, or code block syntax. Do not enclose the output in triple backticks or any other delimiters.

    Conditions: {conditions}
    Source code: {file_contents}
    Similar functions: {similarFunctionsCode}`,
    
    );

    // Create header template for consolidated test file
    const testHeaderPrompt = PromptTemplate.fromTemplate(
      `
    Create a comprehensive header for a Unity test file that will test multiple functions from a single source file.
    Include all necessary includes and setup/teardown functions that would be shared by all tests.
    
    Follow TI's style guidelines:
    1. Add a BSD-style license header
    2. Include device-family handling with conditional definitions:
       #if defined(DeviceFamily_CC26X4) || defined(DeviceFamily_CC13X4)
         #define FLASH_SECTOR_SIZE    0x800
         #define FLASH_REGION_BASE    CONFIG_NVSINTERNAL
         #define FLASH_REGION_SIZE    0x4000
       #endif
    3. Add utility functions for flash validation:
       - isSectorErased() to verify memory is erased (filled with 0xFF)
       - isSectorProgrammed() to verify memory matches test patterns
    
    The header should be suitable for testing these functions: {function_names}
    Source code: {file_contents}
    
    Only output raw C code without any markdown formatting or code blocks.
    `
    );

    // Set up the chain for generating the header
    const testHeaderChain = testHeaderPrompt.pipe(llm).pipe(new StringOutputParser());
    
    const summariesChain = summariesPrompt.pipe(llm).pipe(
      new StringOutputParser(),
    );
    const testableFunctionsChain = testableFunctionsPrompt
      .pipe(llm)
      .pipe(new JsonOutputParser());
    const exploreConditionsChain = exploreConditionsPrompt
      .pipe(llm)
      .pipe(new JsonOutputParser());
    const testGenPrompt = testGeneratorPrompt.pipe(llm).pipe(
      new StringOutputParser(),
    );

    // Function to get all code from the file
    const getAllCodeFromFunctions = (functions: Array<{functionName: string, functionCode: string}>): string => {
      return functions.map(f => f.functionCode).join("\n\n");
    };

    // Extract all function names
    const functionNames = state.functions.map(f => f.functionName).join(", ");
    
    // First generate the header for the consolidated test file
    console.log(`[${new Date().toISOString()}] Generating test file header for functions: ${functionNames}`);
    const testHeader = await testHeaderChain.invoke({ 
      function_names: functionNames,
      file_contents: getAllCodeFromFunctions(state.functions)
    });
    
    // Start building the consolidated test file
    let consolidatedTestCode = testHeader + "\n\n";
    
    // Track covered functions for full coverage validation
    const allDriverFunctions = state.functions.map(f => f.functionName);
    const coveredFunctions = new Set<string>();
    
    // Process each function individually
    for (const funcInfo of state.functions) {
      console.log(`Processing function: ${funcInfo.functionName}`);
      
      // Run the chain to get testable functions - we still use this to validate
      // that the function should be tested
      const chainResult = await RunnablePassthrough.assign({
        summaries: summariesChain,
        file_contents: () => funcInfo.functionCode,
      }).pipe(
        RunnablePassthrough.assign({
          testable_functions: testableFunctionsChain,
        }),
      ).invoke({
        file_contents: funcInfo.functionCode,
      });
      
      // Check if current function is in the testable functions list
      const testableFunctions = chainResult.testable_functions as string[];
      if (!testableFunctions.includes(funcInfo.functionName)) {
        console.log(`Function ${funcInfo.functionName} is not considered testable, skipping`);
        continue;
      }
      
      // Generate test conditions for this function
      const conditions = await exploreConditionsChain.invoke({
        function: funcInfo.functionName,
        file_contents: funcInfo.functionCode,
      });
      
      // Generate test code for this function
      const functionTestCode = await testGenPrompt.invoke({
        function_name: funcInfo.functionName,
        conditions: conditions,
        file_contents: funcInfo.functionCode,
        similarFunctionsCode: state.similarFunctionsCode,
      });
      
      // Add function's test code to consolidated output
      consolidatedTestCode += `/* Tests for ${funcInfo.functionName} */\n${functionTestCode}\n\n`;
      
      // Mark function as covered
      coveredFunctions.add(funcInfo.functionName);
    }
    
    // If any functions were not covered, generate basic tests for them
    const uncoveredFunctions = allDriverFunctions.filter(f => !coveredFunctions.has(f));
    if (uncoveredFunctions.length > 0) {
      console.log(`Generating basic tests for ${uncoveredFunctions.length} uncovered functions`);
      
      for (const uncoveredFunc of uncoveredFunctions) {
        const funcInfo = state.functions.find(f => f.functionName === uncoveredFunc);
        if (funcInfo) {
          // Generate a basic test with minimal conditions
          const basicConditions = {
            [uncoveredFunc]: [
              "Basic success condition checking normal operation",
              "Basic failure condition with invalid parameters"
            ]
          };
          
          // Generate test code
          const basicTestCode = await testGenPrompt.invoke({
            function_name: uncoveredFunc,
            conditions: basicConditions,
            file_contents: funcInfo.functionCode,
            similarFunctionsCode: state.similarFunctionsCode,
          });
          
          // Add to consolidated output
          consolidatedTestCode += `/* Basic tests for ${uncoveredFunc} */\n${basicTestCode}\n\n`;
        }
      }
    }
    
    // Add main function at the end with proper UNITY_BEGIN/END and RUN_TEST for each
    consolidatedTestCode += `
/* Main test runner */
int main(void) {
    UNITY_BEGIN();
    
    /* Run all tests */
${state.functions.map(f => {
  // Check if the function name has any wrapper tests
  const pattern = new RegExp(`test_[a-z_]*${f.functionName.toLowerCase().replace(/^.*_/, '')}[a-z0-9_]*\\(void\\)`, 'gi');
  const wrapperMatches = consolidatedTestCode.match(pattern);
  
  if (wrapperMatches && wrapperMatches.length > 0) {
    // Return run statements for all wrappers
    return wrapperMatches.map(wrapper => {
      const funcName = wrapper.substring(0, wrapper.indexOf('('));
      return `    RUN_TEST(${funcName});`;
    }).join("\n");
  } else {
    // Fallback to simple test name
    return `    RUN_TEST(test_${f.functionName.toLowerCase().replace('nvs_', 'nvs_')});`;
  }
}).join("\n")}
    
    return UNITY_END();
}
`;

    console.log(
      `[${new Date().toISOString()}] === LLM test generation complete ===`
    );
    console.log(`Generated ${consolidatedTestCode.length} characters of test code for ${state.functions.length} functions`);
    
    // Add a notification about multi-function testing
    vscode.window.showInformationMessage(
      `Generated tests for ${state.functions.length} functions in a consolidated test file.`
    );

    return { generatedTestCode: consolidatedTestCode };
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

// Store instances globally for deactivate to access
let vectorManagerInstance: SimpleVectorManager | null = null;
let tiTestIntegratorInstance: TITestIntegrator | null = null;
// Track if LangSmith tracing is enabled
let langsmithTracingEnabled = false;

export function activate(context: vscode.ExtensionContext) {
  console.log(
    `[${new Date().toISOString()}] RAG Unit Test Generator extension activated!`
  );

  // Initialize command disposables
  let helloWorldDisposable: vscode.Disposable | undefined;
  let printVectorsDisposable: vscode.Disposable | undefined;
  let generateUnitTestDisposable: vscode.Disposable | undefined;
  let configureDisposable: vscode.Disposable | undefined;
  let generatePythonTestDisposable: vscode.Disposable | undefined;

  // Initialize the vector manager
  const vectorManager = new SimpleVectorManager();
  vectorManagerInstance = vectorManager; // Store for deactivate
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Initialize the TI test integrator
  const tiTestIntegrator = new TITestIntegrator(vectorManager, workspaceRoot);
  tiTestIntegratorInstance = tiTestIntegrator; // Store for deactivate

  // Initialize the C parser
  const cParser = new CParser();

  // Asynchronously initialize both components
  Promise.all([
    vectorManager.initialize(),
    tiTestIntegrator.initialize()
  ]).then(([vectorInitialized, tiInitialized]) => {
    console.log(`Vector manager initialized: ${vectorInitialized}`);
    console.log(`TI test integrator initialized: ${tiInitialized}`);
  }).catch(error => {
    console.error("Error during initialization:", error);
  });

  // Check if vector DB is disabled in settings
  const config = vscode.workspace.getConfiguration("rag-unit-testing");
  const vectorDBDisabled = config.get("disableVectorDB") === true;

  if (vectorDBDisabled) {
    console.log("Vector database functionality disabled by user configuration");
    vscode.window.showInformationMessage(
      "Running in LLM-only mode (Vector DB disabled in settings)"
    );
  }

  try {
    // Create StateGraph with explicit GraphState
    const workflow = new StateGraph<GraphState>({
      channels: {
        functions: {
          value: (x?: Array<{functionName: string, functionCode: string}>, y?: Array<{functionName: string, functionCode: string}>): Array<{functionName: string, functionCode: string}> => 
            y ?? x ?? [],
          default: (): Array<{functionName: string, functionCode: string}> => [],
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
        return retrieveContext(state, vectorManager, tiTestIntegrator);
      },
    });

    const generateTestsNode = new RunnableLambda({
      func: async (state: GraphState): Promise<Partial<GraphState>> => {
        return generateTests(state);
      },
    });

    // Add nodes to the graph
    workflow.addNode("retrieveContext", retrieveContextNode);
    workflow.addNode("generateTests", generateTestsNode);

    // Define the workflow correctly using START constant and explicit type casts
    workflow.addEdge(START, "retrieveContext" as unknown as "__start__");
    workflow.addEdge(
      "retrieveContext" as unknown as "__start__",
      "generateTests" as unknown as "__start__"
    );
    workflow.addEdge("generateTests" as unknown as "__start__", END);

    // Compile the graph
    const app = workflow.compile();
    console.log("LangGraph workflow compiled successfully.");

    if (langsmithTracingEnabled) {
      console.log("LangGraph workflow will be traced in LangSmith");
    }

    // Register commands only once
    helloWorldDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.helloWorld",
      () => {
        vscode.window.showInformationMessage("Hello World from RAG Unit Testing!");
      }
    );

    printVectorsDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.printVectorEmbeddings",
      async () => {
        vscode.window.showInformationMessage("Print vectors command executed");
      }
    );

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

          // 2. Extract all functions from the file
          let parsedFunctions: Array<{
            functionName: string;
            content: string;
            parameters: string[];
            returnType: string;
          }> = [];

          // Try using Tree-sitter parser first
          if (cParser && (await cParser.initialize())) {
            console.log("Using Tree-sitter parser to find functions");
            parsedFunctions = cParser.parseFunctions(fileContent, filePath);
          }

          // Fall back to regex parser if needed
          if (parsedFunctions.length === 0) {
            console.log("Falling back to regex parser");
            if (cParser) {
              // Use the fallback method from the C parser
              parsedFunctions = cParser.fallbackParseFunctions(fileContent);
            } else {
              // Use the original regex parser as final fallback
              parsedFunctions = parseCFunctions(fileContent);
            }
          }

          // Filter out main function or any unwanted functions
          parsedFunctions = parsedFunctions.filter(f => 
            f.functionName !== "main" 
            // Don't filter out functions based on line count, since many valid functions are short
          );

          if (parsedFunctions.length === 0) {
            const userInput = await vscode.window.showInputBox({
              prompt: "No testable functions found. Enter a function name manually:",
              placeHolder: "e.g., calculate_sum"
            });

            if (!userInput) {
              vscode.window.showInformationMessage("Test generation cancelled.");
              return;
            }

            // Add user-provided function
            parsedFunctions.push({
              functionName: userInput,
              content: fileContent, // Use entire file content since we can't isolate
              parameters: [],
              returnType: "unknown"
            });
          }

          // Let user select which functions to test
          const selectedFunctions = await vscode.window.showQuickPick(
            parsedFunctions.map(f => ({ 
              label: f.functionName,
              description: `Returns ${f.returnType}, ${f.parameters.length} parameters`
            })),
            { 
              canPickMany: true, 
              placeHolder: 'Select functions to generate tests for (multi-select)',
              title: 'Select Functions for Test Generation'
            }
          );

          if (!selectedFunctions || selectedFunctions.length === 0) {
            vscode.window.showInformationMessage("No functions selected. Test generation cancelled.");
            return;
          }

          // Map selected functions to their parsed data
          const functionsToTest = selectedFunctions.map(selection => {
            const func = parsedFunctions.find(f => f.functionName === selection.label);
            if (!func) {
              // This shouldn't happen as selections come from parsedFunctions, but handle just in case
              return {
                functionName: selection.label,
                functionCode: "// Function code not found"
              };
            }
            return {
              functionName: func.functionName,
              functionCode: func.content
            };
          });

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
            functions: functionsToTest,
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
              title: `Generating tests for ${functionsToTest.length} functions...`,
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

                // Display test file and validation results
                try {
                  // Show the test file
                  const doc = await vscode.workspace.openTextDocument(testFileUri);
                  await vscode.window.showTextDocument(doc);

                  // Validate the generated test code
                  const validator = new TestCaseValidator();
                  const validationResult = validator.validate(testCode);
                  
                  // Show validation results
                  validator.showValidationResults(validationResult, testCode);

                  vscode.window.showInformationMessage(
                    `Generated unit test with quality score: ${validationResult.score}%`
                  );
                } catch (error: any) {
                  console.error("Error during test validation:", error);
                  vscode.window.showErrorMessage(
                    `Error validating generated tests: ${error.message}`
                  );
                }
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

    configureDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.configure",
      () => {
        vscode.window.showInformationMessage("Configure command executed");
      }
    );

    generatePythonTestDisposable = vscode.commands.registerCommand(
      "rag-unit-testing.generatePythonTest",
      async (uri?: vscode.Uri) => {
        // Allow command palette invocation (uri might be undefined)
        let targetUri = uri;

        // If command is run from palette, try to get active editor's URI
        if (!targetUri && vscode.window.activeTextEditor) {
          targetUri = vscode.window.activeTextEditor.document.uri;
        }

        if (!targetUri) {
          vscode.window.showErrorMessage(
            "No file selected or active editor found. Please right-click a testcase_*.c file."
          );
          return;
        }

        // Ensure it's a testcase_*.c file
        const fileName = path.basename(targetUri.fsPath);
        if (!fileName.startsWith("testcase_") || !fileName.endsWith(".c")) {
          vscode.window.showWarningMessage(
            "This command only works with testcase_*.c files."
          );
          return;
        }

        try {
          // Show progress indication
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Generating Python test files...",
              cancellable: true,
            },
            async (progress, token) => {
              progress.report({
                increment: 0,
                message: "Analyzing C test file...",
              });

              // Create Python test generator
              const pythonTestGenerator = new PythonTestGenerator();
              
              // Generate Python test files
              progress.report({
                increment: 30,
                message: "Generating Python test files...",
              });
              
              const pythonFilePath = await pythonTestGenerator.generatePythonTest(targetUri!.fsPath);
              
              if (token.isCancellationRequested) {
                vscode.window.showInformationMessage("Python test generation cancelled.");
                return;
              }
              
              progress.report({
                increment: 70,
                message: "Finalizing test files...",
              });

              if (pythonFilePath) {
                // Display the generated Python test file
                const pythonFileUri = vscode.Uri.file(pythonFilePath);
                try {
                  const doc = await vscode.workspace.openTextDocument(pythonFileUri);
                  await vscode.window.showTextDocument(doc);
                  
                  // Show success message
                  vscode.window.showInformationMessage(
                    `Successfully generated Python test files for ${fileName}`
                  );
                } catch (error: any) {
                  console.error("Error opening generated test file:", error);
                  vscode.window.showErrorMessage(
                    `Error opening generated test file: ${error.message}`
                  );
                }
              } else {
                vscode.window.showErrorMessage(
                  "Failed to generate Python test files."
                );
              }
            }
          );
        } catch (error: any) {
          console.error("Error in generatePythonTest command:", error);
          vscode.window.showErrorMessage(
            `Error generating Python test: ${error.message || "Unknown error"}`
          );
        }
      }
    );

    // Add disposables to context subscriptions
    if (helloWorldDisposable) context.subscriptions.push(helloWorldDisposable);
    if (printVectorsDisposable) context.subscriptions.push(printVectorsDisposable);
    if (generateUnitTestDisposable) context.subscriptions.push(generateUnitTestDisposable);
    if (configureDisposable) context.subscriptions.push(configureDisposable);
    if (generatePythonTestDisposable) context.subscriptions.push(generatePythonTestDisposable);

  } catch (error: any) {
    console.error("Error setting up LangGraph workflow:", error);
    vscode.window.showErrorMessage(
      `Failed to set up LangGraph workflow: ${error.message}`
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log(`[${new Date().toISOString()}] RAG Unit Test Generator extension deactivating...`);

  // Clean up the vector manager if it was initialized
  if (vectorManagerInstance) {
    try {
      vectorManagerInstance.dispose();
      console.log("Vector manager resources released");
    } catch (error) {
      console.error("Error disposing vector manager:", error);
    }
  }

  // Clean up the TI test integrator if it was initialized
  if (tiTestIntegratorInstance) {
    try {
      // Add any cleanup needed for TI test integrator
      console.log("TI test integrator resources released");
    } catch (error) {
      console.error("Error cleaning up TI test integrator:", error);
    }
  }

  console.log(`[${new Date().toISOString()}] RAG Unit Test Generator extension deactivated`);
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
