import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

/**
 * Generator for Python test files based on C test implementations
 */
export class PythonTestGenerator {
    /**
     * Generate a Python test file from a C test file
     * @param cTestFilePath Path to the C test file
     */
    public async generatePythonTest(cTestFilePath: string): Promise<string | null> {
        try {
            // Validate file is a test case file
            const fileName = path.basename(cTestFilePath);
            if (!fileName.startsWith("testcase_") || !fileName.endsWith(".c")) {
                vscode.window.showWarningMessage("This feature only works with testcase_*.c files.");
                return null;
            }
            
            // Read the C test file content
            const cTestFileContent = await fs.readFile(cTestFilePath, 'utf8');
            
            // Extract driver name from filename
            const driverName = this.extractDriverName(fileName); // e.g., "nvs" from "testcase_nvs.c"
            
            // Try to find and read the corresponding header file
            let headerContent = "";
            try {
                const headerPath = cTestFilePath.replace(/\.c$/, '.h');
                headerContent = await fs.readFile(headerPath, 'utf8');
            } catch (error) {
                console.log(`No header file found for ${fileName}, continuing without it.`);
            }
            
            // Try to find and read related driver files for context
            const driverFiles = await this.findRelatedDriverFiles(cTestFilePath, driverName);
            
            // Generate Python test file
            const pythonTestContent = await this.generatePythonTestContent(
                cTestFileContent, 
                headerContent,
                driverFiles,
                driverName
            );
            
            if (!pythonTestContent) {
                throw new Error("Failed to generate Python test content");
            }
            
            // Create output file path - main test file
            const pythonFilePath = path.join(
                path.dirname(cTestFilePath),
                `test_${driverName}_general.py`
            );
            
            // Create fw test file path
            const fwFilePath = path.join(
                path.dirname(cTestFilePath),
                `fw_${driverName}_general.py`
            );
            
            // Create the Python test files
            await fs.writeFile(pythonFilePath, pythonTestContent.mainFile);
            await fs.writeFile(fwFilePath, pythonTestContent.fwFile);
            
            if (pythonTestContent.confTestFile) {
                // Create conftest.py if it doesn't exist
                const confTestPath = path.join(path.dirname(cTestFilePath), "conftest.py");
                try {
                    await fs.access(confTestPath);
                    console.log("conftest.py already exists, not overwriting");
                } catch (error) {
                    // File doesn't exist, create it
                    await fs.writeFile(confTestPath, pythonTestContent.confTestFile);
                }
            }
            
            // Show information about the generated files
            vscode.window.showInformationMessage(
                `Generated three Python files:\n1. test_${driverName}_general.py\n2. fw_${driverName}_general.py\n3. conftest.py`
            );
            
            return pythonFilePath;
        } catch (error: any) {
            console.error("Error generating Python test:", error);
            vscode.window.showErrorMessage(`Error generating Python test: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Extract driver name from filename
     */
    private extractDriverName(fileName: string): string {
        // Extract "nvs" from "testcase_nvs.c"
        const match = fileName.match(/testcase_([a-z0-9_]+)\.c/i);
        return match ? match[1].toLowerCase() : "unknown";
    }
    
    /**
     * Find related driver files for context
     */
    private async findRelatedDriverFiles(
        cTestFilePath: string, 
        driverName: string
    ): Promise<{path: string, content: string}[]> {
        const result: {path: string, content: string}[] = [];
        
        try {
            // Get workspace folders
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return result;
            }
            
            // Search for related driver files
            const driverPattern = new RegExp(`${driverName}`, 'i');
            const filePattern = new vscode.RelativePattern(workspaceFolders[0].uri.fsPath, "**/*.{c,h}");
            const files = await vscode.workspace.findFiles(filePattern);
            
            // Filter files related to the driver
            const driverFiles = files.filter(file => {
                const fileName = path.basename(file.fsPath);
                return driverPattern.test(fileName) && 
                       !fileName.startsWith("test") && 
                       !fileName.startsWith("testcase");
            });
            
            // Read content of driver files
            for (const file of driverFiles.slice(0, 5)) { // Limit to first 5 files
                try {
                    const content = await fs.readFile(file.fsPath, 'utf8');
                    result.push({
                        path: file.fsPath,
                        content
                    });
                } catch (error) {
                    console.warn(`Failed to read driver file ${file.fsPath}:`, error);
                }
            }
        } catch (error) {
            console.error("Error finding related driver files:", error);
        }
        
        return result;
    }
    
    /**
     * Generate Python test content using LLM
     */
    private async generatePythonTestContent(
        cTestContent: string, 
        headerContent: string,
        driverFiles: {path: string, content: string}[],
        driverName: string
    ): Promise<{mainFile: string, fwFile: string, confTestFile?: string} | null> {
        // Get OpenAI API key from VS Code settings or environment variables
        const config = vscode.workspace.getConfiguration("rag-unit-testing");
        const openaiApiKey = (config.get("openaiApiKey") as string) || process.env.OPENAI_API_KEY;
        
        if (!openaiApiKey) {
            vscode.window.showErrorMessage(
                "OpenAI API key is not configured in either VS Code settings or environment variables."
            );
            return null;
        }
        
        try {
            const llm = new ChatOpenAI({
                modelName: "gpt-4o-mini",
                temperature: 0.2,
                apiKey: openaiApiKey,
            });

            // Create simple prompts as regular strings
            
            // Generate main test file
            const mainTestPrompt = `Create a Python test file (test_${driverName}_general.py) for the ${driverName} driver that will execute C tests. 
The test file should use pytest, import TestCase from fw_${driverName}_general, and use target.core0.execute_test() to run the C implementations.
Include proper docstrings and use pytest.mark.parametrize for test cases.

Here is the C test file:
${cTestContent}

Here is the header file:
${headerContent}`;

            // Generate firmware test file
            const fwTestPrompt = `Create a Python enum file (fw_${driverName}_general.py) that maps test case names to numeric values for C testing.
Use IntEnum from the enum module and create a TestCase class that contains all test functions from this C file:
${cTestContent}

Each enum value should map to a C test function and include docstrings.`;

            // Generate conftest file
            const confTestPrompt = `Create a pytest conftest.py file for ${driverName} driver testing with:
1. Device-specific constants (FLASH_SECTOR_SIZE, CONFIG_NVSINTERNAL, etc.)
2. Test fixtures for setup and teardown
3. Common utility functions
4. Proper docstrings

Based on this C test implementation:
${cTestContent}`;

            // Call LLM for each file separately
            console.log("Generating main test file...");
            const mainResponse = await llm.invoke(mainTestPrompt);
            const mainFile = mainResponse.content.toString();
            
            console.log("Generating firmware test file...");
            const fwResponse = await llm.invoke(fwTestPrompt);
            const fwFile = fwResponse.content.toString();
            
            console.log("Generating conftest file...");
            const confResponse = await llm.invoke(confTestPrompt);
            const confTestFile = confResponse.content.toString();
            
            return {
                mainFile,
                fwFile,
                confTestFile
            };
        } catch (error: any) {
            console.error("Error generating Python test content with LLM:", error);
            vscode.window.showErrorMessage(`LLM generation failed: ${error.message}`);
            return null;
        }
    }
} 