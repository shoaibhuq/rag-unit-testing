import * as vscode from "vscode";

/**
 * Test Case Validation Result
 */
export interface ValidationResult {
  score: number;
  issues: string[];
  suggestions: string[];
  tiStyleCompliance: {
    deviceFamilyHandling: boolean;
    utilityFunctions: boolean;
    parameterization: boolean;
    explicitTestRunner: boolean;
    richAssertionMessages: boolean;
    properLicenseHeader: boolean;
    fullApiCoverage: boolean;
  };
}

/**
 * Test Case Validator
 * Validates generated test cases against best practices
 */
export class TestCaseValidator {
  /**
   * Validate a generated test case
   * @param testCode The generated test code to validate
   * @returns Validation result with score and suggestions
   */
  validate(testCode: string): ValidationResult {
    const result: ValidationResult = {
      score: 0,
      issues: [],
      suggestions: [],
      tiStyleCompliance: {
        deviceFamilyHandling: false,
        utilityFunctions: false,
        parameterization: false,
        explicitTestRunner: false,
        richAssertionMessages: false,
        properLicenseHeader: false,
        fullApiCoverage: false,
      }
    };

    // Basic test structure checks
    if (!testCode.includes("UNITY_BEGIN()")) {
      result.issues.push("Missing UNITY_BEGIN() in test runner");
    }

    if (!testCode.includes("UNITY_END()")) {
      result.issues.push("Missing UNITY_END() in test runner");
    }

    if (!testCode.includes("RUN_TEST(")) {
      result.issues.push("No tests are being run with RUN_TEST()");
    }

    // Check for explicit test runner function
    const hasExplicitTestRunner = testCode.includes("int main(void)") && 
                                  testCode.includes("UNITY_BEGIN()") && 
                                  testCode.includes("UNITY_END()");
    result.tiStyleCompliance.explicitTestRunner = hasExplicitTestRunner;
    if (!hasExplicitTestRunner) {
      result.suggestions.push("Add an explicit test runner function (main) that lists all tests");
    }

    // Check for Device Family handling (#if defined(DeviceFamily_...))
    const hasDeviceFamilyHandling = testCode.includes("#if defined(DeviceFamily_") || 
                                  testCode.includes("#include \"ti_drivers_config.h\"");
    result.tiStyleCompliance.deviceFamilyHandling = hasDeviceFamilyHandling;
    if (!hasDeviceFamilyHandling) {
      result.suggestions.push("Add device family handling with #if defined(DeviceFamily_...) and include ti_drivers_config.h");
    }

    // Check for utility functions
    const hasUtilityFunctions = testCode.includes("static uint32_t isSector") ||
                              (testCode.includes("static") && 
                               (testCode.includes("Helper") || testCode.includes("helper")));
    result.tiStyleCompliance.utilityFunctions = hasUtilityFunctions;
    if (!hasUtilityFunctions) {
      result.suggestions.push("Add utility functions like isSectorErased() and isSectorProgrammed() to verify flash contents");
    }

    // Check for parameterization
    const hasParameterization = (testCode.match(/test_[a-z0-9_]+\([^)]+\)/gi) || []).length > 0;
    result.tiStyleCompliance.parameterization = hasParameterization;
    if (!hasParameterization) {
      result.suggestions.push("Convert zero-arg tests to parameterized form with thin wrappers for Unity");
    }

    // Check for rich assertion messages
    const assertCount = (testCode.match(/TEST_ASSERT/g) || []).length;
    const messageAssertCount = (testCode.match(/TEST_ASSERT[^(]+_MESSAGE/g) || []).length;
    result.tiStyleCompliance.richAssertionMessages = messageAssertCount >= assertCount * 0.7; // 70% of asserts have messages
    if (!result.tiStyleCompliance.richAssertionMessages) {
      result.suggestions.push("Add descriptive messages to all TEST_ASSERT calls for better debugging");
    }

    // Check for proper license header
    const hasLicenseHeader = testCode.includes("Copyright") && 
                           (testCode.includes("* All rights reserved") || 
                            testCode.includes("* BSD") || 
                            testCode.includes("* Licensed under"));
    result.tiStyleCompliance.properLicenseHeader = hasLicenseHeader;
    if (!hasLicenseHeader) {
      result.suggestions.push("Add a proper TI-style BSD license header");
    }

    // Check for full API coverage
    const nvsFunctions = [
      "NVS_close", "NVS_control", "NVS_erase", "NVS_getAttrs", 
      "NVS_init", "NVS_lock", "NVS_open", "NVS_Params_init", 
      "NVS_read", "NVS_unlock", "NVS_write"
    ];
    
    const coveredFunctions = nvsFunctions.filter(func => 
      testCode.includes(`test_${func.toLowerCase()}`) || 
      testCode.includes(`test_nvs_${func.split('_')[1].toLowerCase()}`)
    );
    
    const apiCoveragePercent = (coveredFunctions.length / nvsFunctions.length) * 100;
    result.tiStyleCompliance.fullApiCoverage = apiCoveragePercent >= 80; // At least 80% of API covered
    
    if (!result.tiStyleCompliance.fullApiCoverage) {
      const missingFunctions = nvsFunctions.filter(func => 
        !coveredFunctions.includes(func)
      );
      result.suggestions.push(`Increase API coverage by adding tests for: ${missingFunctions.join(', ')}`);
    }

    // Calculate overall score
    const baseScore = 50; // Start with 50%
    const tiStylePoints = Object.values(result.tiStyleCompliance).filter(Boolean).length * 7; // 7 points per compliant area
    const issueDeduction = result.issues.length * 5; // -5 per issue
    
    result.score = Math.min(100, Math.max(0, baseScore + tiStylePoints - issueDeduction));

    return result;
  }

  /**
   * Show validation results to the user
   * @param result Validation result
   * @param testCode The generated test code
   */
  showValidationResults(result: ValidationResult, testCode: string): void {
    // Create a detailed message
    const messageLines = [
      `## Test Quality Score: ${result.score}%`,
      '',
      '### TI Style Compliance:',
      `- Device Family Handling: ${result.tiStyleCompliance.deviceFamilyHandling ? '✅' : '❌'}`,
      `- Utility Functions: ${result.tiStyleCompliance.utilityFunctions ? '✅' : '❌'}`,
      `- Parameterization: ${result.tiStyleCompliance.parameterization ? '✅' : '❌'}`,
      `- Explicit Test Runner: ${result.tiStyleCompliance.explicitTestRunner ? '✅' : '❌'}`,
      `- Rich Assertion Messages: ${result.tiStyleCompliance.richAssertionMessages ? '✅' : '❌'}`,
      `- Proper License Header: ${result.tiStyleCompliance.properLicenseHeader ? '✅' : '❌'}`,
      `- Full API Coverage: ${result.tiStyleCompliance.fullApiCoverage ? '✅' : '❌'}`,
    ];

    if (result.issues.length > 0) {
      messageLines.push('', '### Issues:');
      result.issues.forEach(issue => messageLines.push(`- ${issue}`));
    }

    if (result.suggestions.length > 0) {
      messageLines.push('', '### Suggestions to improve TI compliance:');
      result.suggestions.forEach(suggestion => messageLines.push(`- ${suggestion}`));
    }

    // Show the detailed report in a markdown preview
    const panel = vscode.window.createWebviewPanel(
      'testValidation',
      'Test Validation Results',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: system-ui, sans-serif; padding: 20px; }
          .score { font-size: 24px; font-weight: bold; }
          .good { color: green; }
          .average { color: orange; }
          .poor { color: red; }
          .section { margin-top: 20px; }
          h2 { border-bottom: 1px solid #ddd; padding-bottom: 5px; }
          li { margin-bottom: 8px; }
        </style>
      </head>
      <body>
        <h1>Test Validation Results</h1>
        <div class="score ${result.score >= 80 ? 'good' : result.score >= 60 ? 'average' : 'poor'}">
          Score: ${result.score}%
        </div>
        
        <div class="section">
          <h2>TI Style Compliance</h2>
          <ul>
            <li>Device Family Handling: ${result.tiStyleCompliance.deviceFamilyHandling ? '✅' : '❌'}</li>
            <li>Utility Functions: ${result.tiStyleCompliance.utilityFunctions ? '✅' : '❌'}</li>
            <li>Parameterization: ${result.tiStyleCompliance.parameterization ? '✅' : '❌'}</li>
            <li>Explicit Test Runner: ${result.tiStyleCompliance.explicitTestRunner ? '✅' : '❌'}</li>
            <li>Rich Assertion Messages: ${result.tiStyleCompliance.richAssertionMessages ? '✅' : '❌'}</li>
            <li>Proper License Header: ${result.tiStyleCompliance.properLicenseHeader ? '✅' : '❌'}</li>
            <li>Full API Coverage: ${result.tiStyleCompliance.fullApiCoverage ? '✅' : '❌'}</li>
          </ul>
        </div>
        
        ${result.issues.length > 0 ? `
        <div class="section">
          <h2>Issues</h2>
          <ul>
            ${result.issues.map(issue => `<li>${issue}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
        
        ${result.suggestions.length > 0 ? `
        <div class="section">
          <h2>Suggestions to improve TI compliance</h2>
          <ul>
            ${result.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </body>
      </html>
    `;
  }
} 