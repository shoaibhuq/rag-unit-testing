# Python Test Generator

The Python Test Generator is a feature in the RAG Unit Testing extension that allows you to automatically generate Python test infrastructure files from existing C test implementations. This is particularly useful for TI SimpleLink SDK testing, where test logic is often implemented in C but executed and orchestrated via Python test frameworks.

## Overview

When working with TI driver tests, a common pattern is to have:

1. C test implementation files (`testcase_*.c`) containing the actual test logic
2. Python test files (`test_*_general.py`) that define test cases and parameters
3. Python firmware files (`fw_*_general.py`) that map Python test enumerations to C functions
4. Configuration files (`conftest.py`) that provide fixtures and constants

Manually creating these Python files can be time-consuming and error-prone. The Python Test Generator automates this process by analyzing the C implementation and generating all the necessary Python infrastructure.

## Generated Files

When you use the Python Test Generator, it creates three files:

### 1. Main Test File (`test_<driver>_general.py`)

This file contains:
- Test cases using pytest's `@pytest.mark.parametrize` decorator
- Functions that invoke the C implementations via `target.core0.execute_test()`
- Assertions to validate test results
- Comprehensive docstrings explaining test purposes

Example:
```python
"""
Python test module for nvs driver tests.
This module interacts with C implementation in testcase_nvs.c
"""
import pytest
from fw_nvs_general import TestCase

@pytest.mark.parametrize(
    "test_case", 
    [TestCase.TEST_NVS_READ, TestCase.TEST_NVS_WRITE]
)
def test_nvs_basic(target, test_case):
    """Run basic NVS test cases implemented in C."""
    result = target.core0.execute_test(test_case.value)
    assert result == 0, f"Test case {test_case.name} failed with result {result}"
```

### 2. Firmware Test File (`fw_<driver>_general.py`)

This file contains:
- Enum class that maps Python test case names to numeric values for C
- One-to-one mapping between enum values and C test functions
- Docstrings explaining the purpose of each test case

Example:
```python
"""
Firmware test case definitions for nvs driver tests.
Maps Python test enumerations to C test implementations.
"""
from enum import IntEnum

class TestCase(IntEnum):
    """Test case enumeration for nvs driver tests."""
    TEST_NVS_READ = 1  # Maps to test_nvs_read in C
    TEST_NVS_WRITE = 2  # Maps to test_nvs_write in C
    TEST_NVS_ERASE = 3  # Maps to test_nvs_erase in C
```

### 3. Configuration File (`conftest.py`)

This file contains:
- Device-specific constants (flash sizes, memory addresses, etc.)
- Pytest fixtures for test setup and teardown
- Common test utilities and helper functions

Example:
```python
"""
PyTest configuration for nvs driver tests.
Contains fixtures and constants for test execution.
"""
import pytest

# Device-specific constants
FLASH_SECTOR_SIZE = 0x800
CONFIG_NVSINTERNAL = 0x20000000

@pytest.fixture(scope="function")
def setup_nvs(target):
    """Initialize NVS driver for testing."""
    # Setup code
    yield
    # Teardown code
```

## Usage

To use the Python Test Generator:

1. Open a C test implementation file (must be named `testcase_*.c`)
2. Right-click and select "Generate Python Test Files - RAG Unit Testing"
3. The extension will analyze the C file and generate the three Python files
4. After generation, the main test file will be opened in the editor

## Technical Details

The Python Test Generator uses:

- LLM-based analysis of C code to identify test functions and patterns
- OpenAI's GPT models to generate appropriate Python code
- Smart detection of driver names and test function signatures
- Context gathering from related driver files for better understanding
- Multi-file generation with proper cross-referencing between files

## Configuration

The Python Test Generator uses the same OpenAI API key configuration as the rest of the extension. No additional configuration is required.

## Limitations

- The generator works best with well-structured C test files that follow TI conventions
- Generated Python files may need minor adjustments for complex test scenarios
- The `conftest.py` file is only created if it doesn't already exist to avoid overwriting custom configurations 