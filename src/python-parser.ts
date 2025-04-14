import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

// Interface for parsed Python function/class/method
export interface PythonCodeElement {
    name: string;
    type: 'function' | 'class' | 'method';
    content: string;
    startLine: number;
    endLine: number;
    docstring?: string;
    parentClass?: string; // For methods
    parameters: string[]; // Function parameters
    returnType?: string; // Function return type
    decorators: string[]; // Function decorators
}

// Interface for parsed Python file
export interface ParsedPythonFile {
    filePath: string;
    elements: PythonCodeElement[];
}

/**
 * PythonParser class for extracting functions, classes, and methods from Python files
 */
export class PythonParser {
    private initialized: boolean = false;

    /**
     * Initialize the parser
     */
    public async initialize(): Promise<boolean> {
        this.initialized = true;
        return true;
    }

    /**
     * Parse a Python file to extract functions, classes, and methods
     * @param filePath Path to the Python file
     * @returns ParsedPythonFile object containing the extracted elements
     */
    public async parseFile(filePath: string): Promise<ParsedPythonFile> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            return this.parseContent(fileContent, filePath);
        } catch (error) {
            console.error(`Error parsing Python file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Parse Python content to extract functions, classes, and methods
     * @param content Python file content
     * @param filePath Path to the Python file (for reference)
     * @returns ParsedPythonFile object containing the extracted elements
     */
    public parseContent(content: string, filePath: string): ParsedPythonFile {
        const elements: PythonCodeElement[] = [];
        const lines = content.split('\n');
        
        let currentClass: string | undefined;
        let currentElement: PythonCodeElement | undefined;
        let inDocstring = false;
        let docstringLines: string[] = [];
        let currentDecorators: string[] = [];
        let functionContent: string[] = [];
        let indentLevel = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const currentIndent = line.search(/\S/);
            
            // Skip empty lines and comments
            if (!trimmedLine || trimmedLine.startsWith('#')) {
                if (currentElement) {
                    functionContent.push(line);
                }
                continue;
            }
            
            // Check for decorators
            const decoratorMatch = trimmedLine.match(/^@(\w+)(?:\(([^)]*)\))?/);
            if (decoratorMatch) {
                const decoratorName = decoratorMatch[1];
                const decoratorArgs = decoratorMatch[2] ? `(${decoratorMatch[2]})` : '';
                currentDecorators.push(`@${decoratorName}${decoratorArgs}`);
                continue;
            }
            
            // Check for class definition
            const classMatch = trimmedLine.match(/^class\s+(\w+)(?:\(([^)]*)\))?:/);
            if (classMatch) {
                // Save previous element if exists
                if (currentElement) {
                    currentElement.content = functionContent.join('\n');
                    elements.push(currentElement);
                }
                
                const className = classMatch[1];
                currentClass = className;
                
                // Extract docstring if present
                let docstring = '';
                let j = i + 1;
                while (j < lines.length && (lines[j].trim().startsWith('"""') || lines[j].trim().startsWith("'''"))) {
                    docstring += lines[j].trim() + '\n';
                    j++;
                }
                
                currentElement = {
                    name: className,
                    type: 'class',
                    content: line,
                    startLine: i + 1,
                    endLine: i + 1,
                    docstring: docstring.trim() || undefined,
                    parameters: [],
                    decorators: []
                };
                
                functionContent = [line];
                currentDecorators = [];
                continue;
            }
            
            // Check for function definition
            const functionMatch = trimmedLine.match(/^def\s+(\w+)\s*\((.*)\)(?:\s*->\s*([^:]+))?:/);
            if (functionMatch) {
                // Save previous element if exists
                if (currentElement) {
                    currentElement.content = functionContent.join('\n');
                    elements.push(currentElement);
                }
                
                const functionName = functionMatch[1];
                const paramsString = functionMatch[2];
                const returnType = functionMatch[3] ? functionMatch[3].trim() : undefined;
                
                // Parse parameters
                const parameters = this.parseParameters(paramsString);
                
                // Extract docstring if present
                let docstring = '';
                let j = i + 1;
                while (j < lines.length && (lines[j].trim().startsWith('"""') || lines[j].trim().startsWith("'''"))) {
                    docstring += lines[j].trim() + '\n';
                    j++;
                }
                
                currentElement = {
                    name: functionName,
                    type: currentClass ? 'method' : 'function',
                    content: line,
                    startLine: i + 1,
                    endLine: i + 1,
                    docstring: docstring.trim() || undefined,
                    parameters: parameters,
                    returnType: returnType,
                    parentClass: currentClass,
                    decorators: [...currentDecorators]
                };
                
                functionContent = [line];
                currentDecorators = [];
                continue;
            }
            
            // Add line to current element's content if we have one
            if (currentElement) {
                functionContent.push(line);
            }
        }
        
        // Add the last element if exists
        if (currentElement) {
            currentElement.content = functionContent.join('\n');
            elements.push(currentElement);
        }
        
        return {
            filePath,
            elements
        };
    }

    /**
     * Parse parameters string into array of parameter strings
     * @param paramsString The parameters string from the function definition
     * @returns Array of parameter names
     */
    private parseParameters(paramsString: string): string[] {
        if (!paramsString) {
            return [];
        }

        return paramsString
            .split(',')
            .map(param => {
                // Split on ':' to get just the parameter name
                const [name] = param.split(':').map(s => s.trim());
                // Split on '=' to get just the parameter name without default value
                return name.split('=')[0].trim();
            })
            .filter(param => param !== 'self' && param !== 'cls' && param !== '');
    }

    /**
     * Find a specific function, class, or method in a Python file
     * @param filePath Path to the Python file
     * @param elementName Name of the element to find
     * @returns The found element or undefined if not found
     */
    public async findElement(filePath: string, elementName: string): Promise<PythonCodeElement | undefined> {
        const parsedFile = await this.parseFile(filePath);
        return parsedFile.elements.find(element => element.name === elementName);
    }

    /**
     * Get all functions, classes, and methods in a Python file
     * @param filePath Path to the Python file
     * @returns Array of PythonCodeElement objects
     */
    public async getAllElements(filePath: string): Promise<PythonCodeElement[]> {
        const parsedFile = await this.parseFile(filePath);
        return parsedFile.elements;
    }
} 