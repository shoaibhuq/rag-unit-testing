// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// Function to generate unit test code
function generateUnitTestCode(
  functionName: string,
  parameters: string[]
): string {
  const testFunctionName = `test_${functionName}`;
  const includes = `#include <unity.h>\n#include "${functionName}.h"\n\n`;

  const testFunction =
    `void ${testFunctionName}(void) {\n` +
    `    // TODO: Implement test cases\n` +
    `    TEST_ASSERT_EQUAL(1, 1); // Example test\n` +
    `}\n\n`;

  const setupFunction =
    `void setUp(void) {\n` + `    // TODO: Setup code\n` + `}\n\n`;

  const tearDownFunction =
    `void tearDown(void) {\n` + `    // TODO: Cleanup code\n` + `}\n\n`;

  const mainFunction =
    `int main(void) {\n` +
    `    UNITY_BEGIN();\n` +
    `    RUN_TEST(${testFunctionName});\n` +
    `    return UNITY_END();\n` +
    `}\n`;

  return (
    includes + testFunction + setupFunction + tearDownFunction + mainFunction
  );
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "rag-unit-testing" is now active!'
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const helloWorldDisposable = vscode.commands.registerCommand(
    "rag-unit-testing.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage(
        "Hello World from rag-unit-testing!"
      );
    }
  );

  // Register the generate unit test command
  const generateUnitTestDisposable = vscode.commands.registerCommand(
    "rag-unit-testing.generateUnitTest",
    async (uri: vscode.Uri) => {
      try {
        // Get the active text editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor found!");
          return;
        }

        // Get the document content
        const document = editor.document;
        const text = document.getText();

        // Extract function name (simple implementation - can be enhanced)
        const functionMatch = text.match(/^\s*(\w+)\s+(\w+)\s*\(/m);
        if (!functionMatch) {
          vscode.window.showErrorMessage("No function found in the file!");
          return;
        }

        const functionName = functionMatch[2];
        const testFileName = `test_${functionName}.c`;

        // Generate test code
        const testCode = generateUnitTestCode(functionName, []);

        // Create and open the test file
        const testFileUri = vscode.Uri.joinPath(uri, "..", testFileName);
        const testFile = await vscode.workspace.fs.writeFile(
          testFileUri,
          Buffer.from(testCode)
        );

        // Open the test file
        const doc = await vscode.workspace.openTextDocument(testFileUri);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(
          `Generated unit test file: ${testFileName}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error generating unit test: ${error}`);
      }
    }
  );

  context.subscriptions.push(helloWorldDisposable, generateUnitTestDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
