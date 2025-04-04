import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

// Define the interface for parsed functions
export interface ParsedFunction {
  functionName: string;
  content: string;
  parameters: string[];
  returnType: string;
  startLine?: number;
  endLine?: number;
  headerPath?: string;
}

/**
 * Improved C Parser with better handling of C constructs
 */
export class CParser {
  private initialized = false;

  constructor() {
    this.initialized = true;
  }

  /**
   * Initialize the parser
   */
  async initialize(): Promise<boolean> {
    return this.initialized;
  }

  /**
   * Parse C code to extract function definitions
   * Uses an improved regex-based parser with better handling of various C syntax
   */
  parseFunctions(fileContent: string, filePath?: string): ParsedFunction[] {
    try {
      const functions = this.advancedParseFunctions(fileContent);
      console.log(
        `Advanced parser found ${functions.length} functions in ${
          filePath || "code"
        }`
      );
      return functions;
    } catch (error) {
      console.error("Error parsing C file:", error);
      return this.fallbackParseFunctions(fileContent);
    }
  }

  /**
   * Advanced parsing of C functions using multiple regex patterns
   * to handle various C coding styles
   */
  private advancedParseFunctions(fileContent: string): ParsedFunction[] {
    console.log("Using advanced regex-based C parser");
    const functions: ParsedFunction[] = [];

    // Remove comments and preprocess the code
    const preprocessedCode = this.preprocessCode(fileContent);

    // Extract function definitions with multiple patterns
    this.extractFunctionsWithPattern1(preprocessedCode, functions);
    this.extractFunctionsWithPattern2(preprocessedCode, functions);
    this.extractFunctionsWithPattern3(preprocessedCode, functions);

    // Remove duplicates by function name
    const uniqueFunctions: ParsedFunction[] = [];
    const functionNames = new Set<string>();

    functions.forEach((func) => {
      if (!functionNames.has(func.functionName)) {
        functionNames.add(func.functionName);
        uniqueFunctions.push(func);
      }
    });

    return uniqueFunctions;
  }

  /**
   * Preprocess code by removing comments and normalizing whitespace
   */
  private preprocessCode(fileContent: string): string {
    return fileContent
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments /* ... */
      .replace(/\/\/.*$/gm, "") // Remove single-line comments // ...
      .replace(/\r\n/g, "\n"); // Normalize line endings
  }

  /**
   * Pattern 1: Standard C function definition
   * Handles common function format with return type, name, and parameters
   */
  private extractFunctionsWithPattern1(
    code: string,
    functions: ParsedFunction[]
  ): void {
    // Pattern for standard C function definitions
    const functionRegex =
      /(?:^|\n)([a-zA-Z_][\w\s\*]+?)[\s\n]+([a-zA-Z_]\w*)[\s\n]*\(([^)]*)\)[\s\n]*(?:;|\{([\s\S]*?)(?:^|\n)\s*\})/gm;

    let match;
    while ((match = functionRegex.exec(code)) !== null) {
      // Skip if not a valid function
      if (this.shouldSkipMatch(match[1], match[4])) {
        continue;
      }

      const returnType = match[1].trim().replace(/\s+/g, " ");
      const functionName = match[2].trim();
      const paramsString = match[3].trim();
      const content = match[0].trim();

      // Skip main function
      if (functionName === "main") {
        continue;
      }

      const parameters = this.parseParameters(paramsString);

      // Calculate approximate line numbers
      const contentBeforeMatch = code.substring(0, match.index);
      const startLine = (contentBeforeMatch.match(/\n/g) || []).length;
      const linesInMatch = (match[0].match(/\n/g) || []).length;
      const endLine = startLine + linesInMatch;

      functions.push({
        functionName,
        content,
        parameters,
        returnType,
        startLine,
        endLine,
      });
    }
  }

  /**
   * Pattern 2: Functions with K&R style parameter declarations
   * Handles older C style where parameter types are declared after the parameter list
   */
  private extractFunctionsWithPattern2(
    code: string,
    functions: ParsedFunction[]
  ): void {
    // Pattern for K&R style C function definitions
    const functionRegex =
      /(?:^|\n)([a-zA-Z_][\w\s\*]+?)[\s\n]+([a-zA-Z_]\w*)[\s\n]*\(([^{}]*?)\)[\s\n]*\{([^{}]*?\{[^{}]*?\}[^{}]*?)*?\}/gm;

    let match;
    while ((match = functionRegex.exec(code)) !== null) {
      // Skip if already found with pattern 1
      const functionName = match[2].trim();
      if (
        functions.some((f) => f.functionName === functionName) ||
        functionName === "main"
      ) {
        continue;
      }

      // Skip if not a valid function
      if (this.shouldSkipMatch(match[1], match[0])) {
        continue;
      }

      const returnType = match[1].trim().replace(/\s+/g, " ");
      const paramsString = match[3].trim();
      const content = match[0].trim();

      const parameters = this.parseParameters(paramsString);

      // Calculate approximate line numbers
      const contentBeforeMatch = code.substring(0, match.index);
      const startLine = (contentBeforeMatch.match(/\n/g) || []).length;
      const linesInMatch = (match[0].match(/\n/g) || []).length;
      const endLine = startLine + linesInMatch;

      functions.push({
        functionName,
        content,
        parameters,
        returnType,
        startLine,
        endLine,
      });
    }
  }

  /**
   * Pattern 3: Functions with macros in signatures
   * Handles functions that use macros in return types or attributes
   */
  private extractFunctionsWithPattern3(
    code: string,
    functions: ParsedFunction[]
  ): void {
    // Pattern for functions with macros in signatures
    const functionRegex =
      /(?:^|\n)([\w\s\*\(\)]+?)[\s\n]+([a-zA-Z_]\w*)[\s\n]*\(([^)]*)\)[\s\n]*(?:;|\{([\s\S]*?)(?:^|\n)\s*\})/gm;

    let match;
    while ((match = functionRegex.exec(code)) !== null) {
      // Skip if already found with other patterns
      const functionName = match[2].trim();
      if (
        functions.some((f) => f.functionName === functionName) ||
        functionName === "main"
      ) {
        continue;
      }

      // Skip if not a valid function
      if (
        this.shouldSkipMatch(match[1], match[4]) ||
        !this.isValidFunctionName(functionName) ||
        !match[4]
      ) {
        continue;
      }

      const returnType = match[1].trim().replace(/\s+/g, " ");
      const paramsString = match[3].trim();
      const content = match[0].trim();

      const parameters = this.parseParameters(paramsString);

      // Calculate approximate line numbers
      const contentBeforeMatch = code.substring(0, match.index);
      const startLine = (contentBeforeMatch.match(/\n/g) || []).length;
      const linesInMatch = (match[0].match(/\n/g) || []).length;
      const endLine = startLine + linesInMatch;

      functions.push({
        functionName,
        content,
        parameters,
        returnType,
        startLine,
        endLine,
      });
    }
  }

  /**
   * Parse parameters string into array of parameter strings
   */
  private parseParameters(paramsString: string): string[] {
    if (!paramsString || paramsString.trim() === "void") {
      return [];
    }

    return paramsString
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "void" && p !== "");
  }

  /**
   * Check if a match should be skipped (not a valid function)
   */
  private shouldSkipMatch(
    returnType: string,
    body: string | undefined
  ): boolean {
    if (!body) return true;

    return (
      returnType.includes(";") ||
      returnType.trim().startsWith("struct") ||
      returnType.trim().startsWith("enum") ||
      returnType.trim().startsWith("typedef") ||
      returnType.trim().startsWith("#include") ||
      returnType.trim().startsWith("#define")
    );
  }

  /**
   * Check if a function name is valid
   */
  private isValidFunctionName(name: string): boolean {
    // Valid C function names start with a letter or underscore followed by letters, numbers, or underscores
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  }

  /**
   * Fallback parsing method for when the advanced parser fails
   */
  fallbackParseFunctions(fileContent: string): ParsedFunction[] {
    console.warn("Using fallback regex parser");
    const functions: ParsedFunction[] = [];

    // Remove comments first to simplify parsing
    const contentWithoutComments = fileContent
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments /* ... */
      .replace(/\/\/.*$/gm, ""); // Remove single-line comments // ...

    // Simple regex pattern for function definitions
    const functionRegex =
      /(?:^|\n)([a-zA-Z_][\w\s\*]+?)[\s\n]+([a-zA-Z_]\w*)[\s\n]*\(([^)]*)\)[\s\n]*(?:;|\{([\s\S]*?)(?:^|\n)\s*\})/gm;

    let match;
    while ((match = functionRegex.exec(contentWithoutComments)) !== null) {
      // Filter out non-functions
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

      const returnType = match[1].trim().replace(/\s+/g, " ");
      const functionName = match[2].trim();
      const paramsString = match[3].trim();
      const content = match[0].trim();

      // Skip main function
      if (functionName === "main") {
        continue;
      }

      const parameters = paramsString
        ? paramsString
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p !== "void" && p !== "")
        : [];

      // Calculate line numbers (approximate)
      const contentBeforeMatch = fileContent.substring(0, match.index);
      const startLine = (contentBeforeMatch.match(/\n/g) || []).length;
      const linesInMatch = (match[0].match(/\n/g) || []).length;
      const endLine = startLine + linesInMatch;

      functions.push({
        functionName,
        content,
        parameters,
        returnType,
        startLine,
        endLine,
      });
    }

    return functions;
  }
}
