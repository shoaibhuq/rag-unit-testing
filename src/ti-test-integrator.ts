// ti-test-integrator.ts
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { SimpleVectorManager } from "./simple-vector";

// Define interface for TI test case metadata
interface TestCaseMetadata {
  driver: string;
  testType: 'general' | 'board_specific';
  boardSupport: string[];
  osSupport: string[];
  toolchain: string[];
  dependencies: string[];
  testFiles: {
    c: string[];
    h?: string[];
    py?: string[];
    syscfg?: string[];
  };
  sourceFiles: string[];
  description?: string;
  created: string;
  updated: string;
  boardConfigs?: Record<string, any>;
}

// Define new interface for board configurations from syscfg
interface BoardConfig {
  boardName: string;
  components: Record<string, any>;
  pinConfigurations: Record<string, any>;
}

// Define new interfaces for test patterns
interface TestPattern {
  name: string;
  description: string;
  category: 'setup' | 'execution' | 'assertion' | 'cleanup' | 'error-handling' | 'hardware-config';
  code: string;
  boardSpecific?: boolean;
  targetBoards?: string[];
}

interface TestSectionMarkers {
  setup: RegExp[];
  execution: RegExp[];
  assertion: RegExp[];
  cleanup: RegExp[];
  errorHandling: RegExp[];
}

/**
 * TI Test Examples Integrator
 * Manages integration of TI test examples into the RAG pipeline
 */
export class TITestIntegrator {
  private vectorManager: SimpleVectorManager;
  private workspaceRoot: string;
  private metadataCache: Map<string, TestCaseMetadata> = new Map();
  private isInitialized: boolean = false;
  private extractedPatterns: TestPattern[] = [];
  private boardConfigurations: Record<string, BoardConfig> = {};
  
  // Patterns to identify different sections of test cases
  private sectionMarkers: TestSectionMarkers = {
    setup: [
      /commonTestOpen/i,
      /setup\(/i,
      /initialize/i,
      /initializeTest/i,
      /Start_Test/i
    ],
    execution: [
      /test_/i,
      /execute/i,
      /run.*test/i,
      /perform/i
    ],
    assertion: [
      /assert/i,
      /TEST_ASSERT/i,
      /EXPECT_/i,
      /ASSERT_/i,
      /verif/i,
      /check/i
    ],
    cleanup: [
      /commonTestClose/i,
      /cleanup/i,
      /teardown/i,
      /finalize/i,
      /End_Test/i,
      /reset/i
    ],
    errorHandling: [
      /if\s*\(.*error/i,
      /try\s*{/i,
      /catch\s*\(/i,
      /error.*handling/i,
      /handle.*exception/i
    ]
  };

  /**
   * Constructor
   * @param vectorManager The vector manager instance for RAG
   * @param workspaceRoot Workspace root path
   */
  constructor(vectorManager: SimpleVectorManager, workspaceRoot: string) {
    this.vectorManager = vectorManager;
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Initialize the TI Test Integrator
   */
  async initialize(): Promise<boolean> {
    try {
      console.log("Initializing TI Test Integrator...");
      
      // Check if the TI examples path exists
      try {
        await fs.access(path.join(this.workspaceRoot, "generator", "ti_test_examples"));
      } catch (error) {
        console.warn(`TI examples path not found at ${path.join(this.workspaceRoot, "generator", "ti_test_examples")}`);
        return false;
      }
      
      // Load metadata for all test cases
      await this.loadTestCaseMetadata();
      
      // Index all test case files for vector search
      await this.indexTestCases();
      
      // Add processing of syscfg files
      await this.processSysConfigFiles();
      
      this.isInitialized = true;
      console.log("TI Test Integrator initialized successfully");
      return true;
    } catch (error) {
      console.error("Error initializing TI Test Integrator:", error);
      return false;
    }
  }

  /**
   * Check if the integrator is initialized
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Load metadata for all test cases
   */
  private async loadTestCaseMetadata(): Promise<void> {
    try {
      const metadataDir = path.join(this.workspaceRoot, "generator", "ti_test_examples", "metadata", "processed", "test_cases");
      
      // Check if the metadata directory exists
      try {
        await fs.access(metadataDir);
      } catch (error) {
        console.warn(`Metadata directory not found at ${metadataDir}`);
        return;
      }
      
      // Read all files in the metadata directory
      const files = await fs.readdir(metadataDir);
      
      // Process each metadata file
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(metadataDir, file);
          const content = await fs.readFile(filePath, "utf8");
          const metadata = JSON.parse(content) as TestCaseMetadata;
          
          // Store metadata in cache
          this.metadataCache.set(file.replace(".json", ""), metadata);
        }
      }
      
      console.log(`Loaded metadata for ${this.metadataCache.size} test cases`);
    } catch (error) {
      console.error("Error loading test case metadata:", error);
      throw error;
    }
  }

  /**
   * Index all test case files for vector search
   */
  private async indexTestCases(): Promise<void> {
    try {
      // Get all test cases with metadata
      const testCases = Array.from(this.metadataCache.values());
      console.log(`Indexing ${testCases.length} test cases...`);
      
      for (const testCase of testCases) {
        try {
          // Get the test case file path
          const testFilePath = await this.getTestCaseFilePath(testCase);
          if (!testFilePath) {
            console.warn(`Could not find test case file for ${testCase.driver}`);
            continue;
          }
          
          // Read C files and index them
          for (const cFilePath of testCase.testFiles.c) {
            try {
              const resolvedPath = path.join(path.dirname(testFilePath), cFilePath);
              const content = await fs.readFile(resolvedPath, 'utf8');
              
              // Use C parser to extract functions
              const functions = this.parseCFunctions(content);
              
              // Store functions in vector database
              for (const func of functions) {
                // Add metadata to the function
                const enhancedFunction = {
                  ...func,
                  filePath: resolvedPath,
                  driverType: testCase.driver,
                  testType: testCase.testType,
                  boardSupport: testCase.boardSupport
                };
                
                // Store for vector search
                await this.storeFunction(enhancedFunction);
              }
              
              // Add to indexed files
              console.log(`Indexed test case file: ${path.basename(resolvedPath)}`);
            } catch (error) {
              console.error(`Error indexing C file ${cFilePath}:`, error);
            }
          }
          
          // Process SysConfig files if available
          if (testCase.testFiles.syscfg && testCase.testFiles.syscfg.length > 0) {
            for (const syscfgPath of testCase.testFiles.syscfg) {
              try {
                const resolvedPath = path.join(path.dirname(testFilePath), syscfgPath);
                const content = await fs.readFile(resolvedPath, 'utf8');
                
                // Parse SysConfig file
                const boardConfigs = await parseSysConfigFile(resolvedPath);
                
                // Add board configurations to test case metadata
                testCase.boardConfigs = boardConfigs;
                
                // Add SysConfig content to the patterns for retrieval
                for (const [boardPattern, config] of Object.entries(boardConfigs)) {
                  const pattern: TestPattern = {
                    name: `config_${path.basename(syscfgPath)}_${boardPattern}`,
                    description: `Hardware configuration for ${boardPattern}`,
                    category: 'hardware-config',
                    code: content,
                    boardSpecific: true,
                    targetBoards: [boardPattern]
                  };
                  
                  this.extractedPatterns.push(pattern);
                }
                
                console.log(`Indexed SysConfig file: ${path.basename(resolvedPath)}`);
              } catch (error) {
                console.error(`Error indexing SysConfig file ${syscfgPath}:`, error);
              }
            }
          }
        } catch (error) {
          console.error(`Error indexing test case ${testCase.driver}:`, error);
        }
      }
      
      console.log(`Completed indexing of TI test examples`);
    } catch (error) {
      console.error(`Error indexing test cases:`, error);
    }
  }

  /**
   * Resolve the actual file path from a metadata file reference
   * @param fileRef File reference from metadata
   * @param metadata Test case metadata
   */
  private async resolveTestFilePath(
    fileRef: string,
    metadata: TestCaseMetadata
  ): Promise<string | null> {
    // Handle TEST path references
    if (fileRef.includes("[TEST]/src/")) {
      const fileName = path.basename(fileRef);
      
      // Search in appropriate test case directories based on metadata
      if (metadata.testType === "general") {
        return path.join(
          this.workspaceRoot,
          "drivers",
          metadata.driver,
          "test_cases",
          "general",
          fileName
        );
      } else if (metadata.testType === "board_specific" && metadata.boardSupport.length > 0) {
        return path.join(
          this.workspaceRoot,
          "drivers",
          metadata.driver,
          "test_cases",
          "board_specific",
          metadata.boardSupport[0],
          fileName
        );
      }
    }
    
    // For now, we can't resolve other path types (like DRIVERS)
    return null;
  }

  /**
   * Enhance test case content with metadata for better RAG context
   * @param content Original file content
   * @param metadata Test case metadata
   */
  private enrichTestCaseContent(
    content: string,
    metadata: TestCaseMetadata
  ): string {
    // Add TI-specific context as comments that will be indexed but not affect the code
    const tiContext = [
      `/* TI-RAG-CONTEXT-START`,
      ` * Driver: ${metadata.driver}`,
      ` * Test Type: ${metadata.testType}`,
      ` * Board Support: ${metadata.boardSupport.join(", ")}`,
      ` * OS Support: ${metadata.osSupport.join(", ")}`,
      ` * Description: Test case for ${metadata.driver} driver ${
        metadata.testType === "board_specific" ? `on ${metadata.boardSupport[0]} board` : "general functionality"
      }`,
      ` * TI-RAG-CONTEXT-END */`,
      "",
    ].join("\n");
    
    // Insert the context after the copyright header (assume header ends with "DAMAGE.")
    const copyrightEndPos = content.indexOf("DAMAGE.");
    if (copyrightEndPos !== -1) {
      const insertPos = content.indexOf("*/", copyrightEndPos) + 2;
      return content.substring(0, insertPos) + "\n\n" + tiContext + content.substring(insertPos);
    }
    
    // If we can't find the copyright end, just prepend it
    return tiContext + content;
  }

  /**
   * Find relevant TI test examples for a given function code
   * @param functionCode The code of the function to test
   * @param driverName Optional driver name to filter results
   */
  public async findRelevantExamples(
    functionCode: string,
    driverName?: string
  ): Promise<{ filePath: string; content: string; metadata: TestCaseMetadata }[]> {
    try {
      if (!this.isInitialized) {
        console.warn("TI Test Integrator not initialized");
        return [];
      }

      // Use vector database to find relevant test cases with proper parameters
      const testCases = await this.vectorManager.findSimilarWithFilters(
        functionCode,
        undefined, // No specific metadata filters
        5 // Limit to 5 results
      );
      
      // Filter and enhance results
      const results: { filePath: string; content: string; metadata: TestCaseMetadata }[] = [];
      
      for (const testCase of testCases) {
        // Only include TI test examples (from our directory)
        if (testCase.filePath && testCase.filePath.includes("ti_test_examples")) {
          // Find matching metadata by parsing the file path
          const fileName = path.basename(testCase.filePath);
          
          // Find metadata that has this file in its test files
          let matchingMetadata: TestCaseMetadata | undefined;
          
          for (const metadata of this.metadataCache.values()) {
            // Only consider matching driver if specified
            if (driverName && metadata.driver !== driverName) {
              continue;
            }
            
            // Check if this metadata contains the file
            const hasFile = metadata.testFiles.c.some(file => file.includes(fileName));
            
            if (hasFile) {
              matchingMetadata = metadata;
              break;
            }
          }
          
          if (matchingMetadata) {
            results.push({
              filePath: testCase.filePath,
              content: testCase.content,
              metadata: matchingMetadata
            });
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error("Error finding relevant TI examples:", error);
      return [];
    }
  }

  /**
   * Extract TI testing patterns for a specific driver
   * @param driverName Driver name
   */
  public async extractTITestingPatterns(driverName: string): Promise<string> {
    try {
      if (!this.isInitialized) {
        return "TI Test Integrator not initialized";
      }

      // Find all metadata for this driver
      const driverMetadata = Array.from(this.metadataCache.values())
        .filter(metadata => metadata.driver === driverName);
      
      if (driverMetadata.length === 0) {
        return `No test examples found for driver: ${driverName}`;
      }
      
      // Analyze patterns in the test cases
      const patterns = {
        initialization: new Set<string>(),
        testTypes: new Set<string>(),
        errorHandling: new Set<string>(),
        cleanup: new Set<string>(),
        assertions: new Set<string>()
      };
      
      // For each metadata entry, analyze the corresponding test files
      for (const metadata of driverMetadata) {
        for (const cFile of metadata.testFiles.c) {
          const filePath = await this.resolveTestFilePath(cFile, metadata);
          
          if (filePath) {
            try {
              const content = await fs.readFile(filePath, "utf8");
              
              // Extract patterns (simplified examples)
              if (content.includes("_init")) {
                patterns.initialization.add("Driver initialization");
              }
              if (content.includes("_open")) {
                patterns.initialization.add("Resource acquisition");
              }
              if (content.includes("_close")) {
                patterns.cleanup.add("Resource release");
              }
              if (content.includes("TEST_FAIL")) {
                patterns.assertions.add("Failure reporting");
              }
              if (content.includes("TEST_PASS")) {
                patterns.assertions.add("Success reporting");
              }
              if (content.includes("if (") && content.includes("return")) {
                patterns.errorHandling.add("Error checking and early return");
              }
              
              // Extract test types
              if (content.includes("Invalid")) {
                patterns.testTypes.add("Invalid parameter testing");
              }
              if (content.includes("Continuous")) {
                patterns.testTypes.add("Continuous operation testing");
              }
              if (content.includes("SingleChannel")) {
                patterns.testTypes.add("Single channel testing");
              }
              // Add more pattern extraction as needed
            } catch (fileError) {
              console.warn(`Error reading test file ${filePath}:`, fileError);
            }
          }
        }
      }
      
      // Format the patterns as a string
      return [
        `# TI Testing Patterns for ${driverName}`,
        "",
        "## Initialization Patterns",
        Array.from(patterns.initialization).map(p => `- ${p}`).join("\n"),
        "",
        "## Test Types",
        Array.from(patterns.testTypes).map(p => `- ${p}`).join("\n"),
        "",
        "## Error Handling Patterns",
        Array.from(patterns.errorHandling).map(p => `- ${p}`).join("\n"),
        "",
        "## Cleanup Patterns",
        Array.from(patterns.cleanup).map(p => `- ${p}`).join("\n"),
        "",
        "## Assertion Patterns",
        Array.from(patterns.assertions).map(p => `- ${p}`).join("\n"),
      ].join("\n");
    } catch (error) {
      console.error("Error extracting TI testing patterns:", error);
      return "Error extracting TI testing patterns";
    }
  }

  /**
   * Extract test patterns from test case files
   * @param testCaseFiles Array of test case file paths
   * @returns Extracted test patterns
   */
  async extractTestPatterns(testCaseFiles: Record<string, string[]>): Promise<TestPattern[]> {
    const patterns: TestPattern[] = [];
    
    // Process C files
    if (testCaseFiles.c) {
      for (const filePath of testCaseFiles.c) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          
          // Extract sections from the test case
          const sections = this.identifyTestSections(content, filePath);
          
          // Add patterns from each section
          Object.entries(sections).forEach(([category, code]) => {
            if (code && code.trim().length > 0) {
              patterns.push({
                name: `${path.basename(filePath)}_${category}`,
                description: `${category} pattern from ${path.basename(filePath)}`,
                category: category as any,
                code
              });
            }
          });
        } catch (error) {
          console.error(`Error extracting patterns from ${filePath}:`, error);
        }
      }
    }
    
    // Process syscfg files
    if (testCaseFiles.syscfg) {
      for (const filePath of testCaseFiles.syscfg) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const boardConfigs = await parseSysConfigFile(filePath);
          
          // Add pattern for each board configuration
          for (const [boardPattern, config] of Object.entries(boardConfigs)) {
            patterns.push({
              name: `config_${path.basename(filePath)}_${boardPattern}`,
              description: `Hardware configuration for ${boardPattern}`,
              category: 'hardware-config',
              code: content,
              boardSpecific: true,
              targetBoards: [boardPattern]
            });
          }
        } catch (error) {
          console.error(`Error extracting patterns from syscfg ${filePath}:`, error);
        }
      }
    }
    
    this.extractedPatterns.push(...patterns);
    console.log(`Extracted ${patterns.length} test patterns from ${Object.keys(testCaseFiles).length} files`);
    
    return patterns;
  }
  
  /**
   * Identify sections within a test case file
   * @param content File content
   * @param filePath File path for reference
   * @returns Object with separated test sections
   */
  private identifyTestSections(content: string, filePath: string): Record<string, string> {
    const lines = content.split('\n');
    const sections: Record<string, string[]> = {
      setup: [],
      execution: [],
      assertion: [],
      cleanup: [],
      errorHandling: []
    };
    
    // Track current function
    let currentFunction = '';
    let inFunction = false;
    let bracketCount = 0;
    let functionLines: string[] = [];
    
    // First pass: extract functions
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for function start
      if (!inFunction && line.match(/\w+\s+\w+\s*\([^)]*\)\s*\{/)) {
        // Extract function name
        const match = line.match(/(\w+)\s*\(/);
        if (match) {
          currentFunction = match[1];
          inFunction = true;
          bracketCount = 1;
          functionLines = [line];
        }
      } 
      // Inside a function
      else if (inFunction) {
        functionLines.push(line);
        
        // Count brackets for nesting
        bracketCount += (line.match(/\{/g) || []).length;
        bracketCount -= (line.match(/\}/g) || []).length;
        
        // Function end
        if (bracketCount === 0) {
          inFunction = false;
          
          // Categorize the function
          const functionCode = functionLines.join('\n');
          this.categorizeFunctionToSections(currentFunction, functionCode, sections);
          
          // Reset
          functionLines = [];
          currentFunction = '';
        }
      }
    }
    
    // Second pass: extract inline patterns that aren't full functions
    let currentSection: keyof typeof sections | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip function declarations (already processed)
      if (line.match(/\w+\s+\w+\s*\([^)]*\)\s*\{/)) {
        continue;
      }
      
      // Check which section this line belongs to
      for (const [section, patterns] of Object.entries(this.sectionMarkers)) {
        if (patterns.some((pattern: RegExp) => pattern.test(line))) {
          currentSection = section as keyof typeof sections;
          break;
        }
      }
      
      // Add line to current section if identified
      if (currentSection && line.trim() && !functionLines.includes(line)) {
        sections[currentSection].push(line);
      }
    }
    
    // Convert arrays to strings
    return Object.fromEntries(
      Object.entries(sections).map(([key, lines]) => [key, lines.join('\n')])
    );
  }
  
  /**
   * Categorize a function into appropriate test sections
   * @param functionName Name of the function
   * @param functionCode Complete function code
   * @param sections Sections object to populate
   */
  private categorizeFunctionToSections(
    functionName: string, 
    functionCode: string, 
    sections: Record<string, string[]>
  ) {
    // Check function name for categorization hints
    let primaryCategory: keyof typeof sections | null = null;
    
    // First try to categorize by function name
    if (/setup|init|open|start/i.test(functionName)) {
      primaryCategory = 'setup';
    } else if (/test|execute|run|perform/i.test(functionName)) {
      primaryCategory = 'execution';
    } else if (/assert|verify|check|expect/i.test(functionName)) {
      primaryCategory = 'assertion';
    } else if (/cleanup|close|tear|end|free/i.test(functionName)) {
      primaryCategory = 'cleanup';
    } else if (/error|exception|handle/i.test(functionName)) {
      primaryCategory = 'errorHandling';
    }
    
    // If categorized by name, add to that section
    if (primaryCategory) {
      sections[primaryCategory].push(functionCode);
      return;
    }
    
    // Otherwise, check content for section markers
    let maxMatches = 0;
    let bestCategory: keyof typeof sections = 'execution'; // Default
    
    for (const [category, patterns] of Object.entries(this.sectionMarkers)) {
      const matchCount = patterns.reduce((count: number, pattern: RegExp) => {
        return count + (functionCode.match(pattern) || []).length;
      }, 0);
      
      if (matchCount > maxMatches) {
        maxMatches = matchCount;
        bestCategory = category as keyof typeof sections;
      }
    }
    
    // Add to best matching category
    sections[bestCategory].push(functionCode);
    
    // Also check for error handling content separately
    if (bestCategory !== 'errorHandling' && 
        (functionCode.includes('if') && 
        (functionCode.includes('error') || functionCode.includes('return')))) {
      // Extract error handling portions
      const lines = functionCode.split('\n');
      const errorLines = lines.filter(line => 
        /if\s*\(.*error|return.*error|error.*handle|catch|throw|try/i.test(line)
      );
      
      if (errorLines.length > 0) {
        sections.errorHandling.push(errorLines.join('\n'));
      }
    }
  }
  
  /**
   * Get test patterns matching a specific category
   * @param category Pattern category to retrieve
   * @returns Array of matching patterns
   */
  getPatternsByCategory(category: string): TestPattern[] {
    return this.extractedPatterns.filter(pattern => pattern.category === category);
  }
  
  /**
   * Get relevant test patterns for a function, including hardware configurations
   * @param functionCode Code of the function to find patterns for
   * @param boardType Optional board type to include specific hardware configurations
   * @returns Object with relevant patterns by category
   */
  async getRelevantPatterns(
    functionCode: string, 
    boardType?: string
  ): Promise<Record<string, TestPattern[]>> {
    // Initialize vector manager if needed
    if (!this.vectorManager.isReady()) {
      await this.vectorManager.initialize();
    }
    
    // Create embeddings in a different way
    // Since we can't directly use the private methods, we'll try an alternative approach
    let functionEmbedding: number[] = [];
    try {
      // Use findSimilarWithFilters with a dummy query to get embeddings
      const similarFuncs = await this.vectorManager.findSimilarWithFilters(functionCode, undefined, 1);
      // We just need the embedding mechanism, not the actual results
    } catch (error) {
      console.error("Error accessing embedding functionality:", error);
    }
    
    // Initialize categories including hardware-config
    const categories = ['setup', 'execution', 'assertion', 'cleanup', 'errorHandling', 'hardware-config'];
    const result: Record<string, TestPattern[]> = {};
    
    // For each category, select patterns
    for (const category of categories) {
      let patterns = this.getPatternsByCategory(category);
      
      // Filter hardware config patterns by board type if specified
      if (category === 'hardware-config' && boardType) {
        patterns = patterns.filter(pattern => 
          !pattern.boardSpecific || 
          (pattern.targetBoards && 
           pattern.targetBoards.some(board => 
             new RegExp(board).test(boardType)
           ))
        );
      }
      
      // For now, just return top 3 patterns without similarity calculation
      result[category] = patterns.slice(0, 3);
    }
    
    return result;
  }

  /**
   * Process all SysConfig files in test examples
   */
  private async processSysConfigFiles(): Promise<void> {
    const syscfgDir = path.join(
      this.workspaceRoot,
      "generator/ti_test_examples/drivers"
    );
    
    try {
      // Recursively find all syscfg.js files
      const syscfgFiles: string[] = [];
      
      // We'll implement a simple recursive search function
      async function findSysConfigFiles(dir: string, files: string[]) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await findSysConfigFiles(fullPath, files);
          } else if (entry.name.endsWith('.syscfg') || 
                    (entry.name.endsWith('.js') && entry.name.includes('syscfg'))) {
            files.push(fullPath);
          }
        }
      }
      
      await findSysConfigFiles(syscfgDir, syscfgFiles);
      console.log(`Found ${syscfgFiles.length} SysConfig files`);
      
      // Process each SysConfig file
      for (const file of syscfgFiles) {
        const configs = await parseSysConfigFile(file);
        
        // Merge with existing configurations
        for (const [boardPattern, config] of Object.entries(configs)) {
          this.boardConfigurations[boardPattern] = config;
        }
        
        // Generate hardware configuration patterns
        for (const [boardPattern, config] of Object.entries(configs)) {
          const pattern: TestPattern = {
            name: `hardware_config_${path.basename(file, path.extname(file))}`,
            description: `Hardware configuration for ${boardPattern}`,
            category: 'hardware-config',
            code: await fs.readFile(file, 'utf8'),
            boardSpecific: true,
            targetBoards: [boardPattern]
          };
          
          this.extractedPatterns.push(pattern);
        }
      }
      
      console.log(`Processed ${Object.keys(this.boardConfigurations).length} board configurations`);
    } catch (error) {
      console.error("Error processing SysConfig files:", error);
    }
  }

  /**
   * Gets the file path for a test case
   * @param testCase The test case metadata
   * @returns The path to the test case file
   */
  private async getTestCaseFilePath(testCase: TestCaseMetadata): Promise<string | null> {
    try {
      if (testCase.testType === "general") {
        return path.join(
          this.workspaceRoot,
          "generator/ti_test_examples/drivers",
          testCase.driver,
          "test_cases/general"
        );
      } else if (testCase.testType === "board_specific" && testCase.boardSupport.length > 0) {
        return path.join(
          this.workspaceRoot,
          "generator/ti_test_examples/drivers",
          testCase.driver,
          "test_cases/board_specific",
          testCase.boardSupport[0]
        );
      }
      return null;
    } catch (error) {
      console.error(`Error getting test case file path for ${testCase.driver}:`, error);
      return null;
    }
  }

  /**
   * Parse C functions from file content
   * @param content File content to parse
   * @returns Array of parsed functions
   */
  private parseCFunctions(content: string): any[] {
    // Simple regex-based C function parser
    const functions = [];
    
    // Remove comments
    const contentWithoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
      .replace(/\/\/.*$/gm, "");        // Remove single-line comments
    
    // Match function declarations with bodies
    const functionRegex = 
      /(\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)(?:(?:\n\})|(?:\r\n\}))/g;
    
    let match;
    while ((match = functionRegex.exec(contentWithoutComments)) !== null) {
      const returnType = match[1];
      const functionName = match[2];
      const parameters = match[3].split(',').map(p => p.trim()).filter(p => p);
      const body = match[4];
      const content = match[0];
      
      // Skip if it's "main" function
      if (functionName === 'main') continue;
      
      functions.push({
        functionName,
        content,
        parameters,
        returnType
      });
    }
    
    return functions;
  }

  /**
   * Store a function in the vector database
   * @param func Function to store
   */
  private async storeFunction(func: any): Promise<void> {
    if (!this.vectorManager.isReady()) {
      await this.vectorManager.initialize();
    }
    
    try {
      // Use the vector manager's store method with metadata
      await this.vectorManager.storeWithMetadata(
        [func],
        {
          driverType: func.driverType,
          testType: func.testType,
          patterns: this.inferPatternTypes(func.content)
        }
      );
    } catch (error) {
      console.error(`Error storing function ${func.functionName}:`, error);
    }
  }

  /**
   * Infer pattern types from function content
   * @param content Function content
   * @returns Array of pattern types
   */
  private inferPatternTypes(content: string): string[] {
    const patterns: string[] = [];
    
    // Detect setup patterns
    if (this.sectionMarkers.setup.some(pattern => pattern.test(content))) {
      patterns.push('setup');
    }
    
    // Detect execution patterns
    if (this.sectionMarkers.execution.some(pattern => pattern.test(content))) {
      patterns.push('execution');
    }
    
    // Detect assertion patterns
    if (this.sectionMarkers.assertion.some(pattern => pattern.test(content))) {
      patterns.push('assertion');
    }
    
    // Detect cleanup patterns
    if (this.sectionMarkers.cleanup.some(pattern => pattern.test(content))) {
      patterns.push('cleanup');
    }
    
    // Detect error handling patterns
    if (this.sectionMarkers.errorHandling.some(pattern => pattern.test(content))) {
      patterns.push('error-handling');
    }
    
    return patterns;
  }
}

/**
 * Parse a SysConfig file to extract board-specific configurations
 * @param filePath Path to the syscfg.js file
 * @returns Parsed board configurations
 */
async function parseSysConfigFile(filePath: string): Promise<Record<string, BoardConfig>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const boardConfigs: Record<string, BoardConfig> = {};
    
    // Extract board patterns using regex
    const boardMatches = content.matchAll(/board\.match\(\/([^\/]+)\/\)/g);
    
    for (const match of boardMatches) {
      const boardPattern = match[1];
      // Find the associated code block
      const blockStartIndex = content.indexOf('{', match.index);
      if (blockStartIndex > 0) {
        // Find the matching closing brace
        let openBraces = 1;
        let closeBraceIndex = blockStartIndex + 1;
        
        while (openBraces > 0 && closeBraceIndex < content.length) {
          if (content[closeBraceIndex] === '{') openBraces++;
          if (content[closeBraceIndex] === '}') openBraces--;
          closeBraceIndex++;
        }
        
        if (closeBraceIndex > blockStartIndex) {
          const configBlock = content.substring(blockStartIndex, closeBraceIndex);
          
          // Extract pin and hardware configurations
          const pinConfigs: Record<string, any> = {};
          const compMatches = configBlock.matchAll(/(\w+)\.\$hardware\s*=\s*([^;]+);/g);
          const pinMatches = configBlock.matchAll(/(\w+)\.(\w+)\.\$assign\s*=\s*"([^"]+)"/g);
          
          // Parse component assignments
          const components: Record<string, any> = {};
          for (const compMatch of compMatches) {
            components[compMatch[1]] = compMatch[2].trim();
          }
          
          // Parse pin assignments
          for (const pinMatch of pinMatches) {
            const component = pinMatch[1];
            const pin = pinMatch[2];
            const assignment = pinMatch[3];
            
            if (!pinConfigs[component]) {
              pinConfigs[component] = {};
            }
            pinConfigs[component][pin] = assignment;
          }
          
          // Store the parsed configuration
          boardConfigs[boardPattern] = {
            boardName: boardPattern,
            components,
            pinConfigurations: pinConfigs
          };
        }
      }
    }
    
    return boardConfigs;
  } catch (error) {
    console.error(`Error parsing SysConfig file ${filePath}:`, error);
    return {};
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have the same length");
  }
  
  // Calculate dot product
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  // Calculate cosine similarity
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
} 