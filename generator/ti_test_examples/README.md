# TI Test Examples Repository

This repository contains a collection of test examples for Texas Instruments drivers, organized to enable RAG-based (Retrieval-Augmented Generation) test case generation.

## Structure

```
ti_test_examples/
├── metadata/
│   ├── project_configs/
│   │   ├── adcbuf.yml
│   │   ├── gpio.yml
│   │   └── uart.yml
│   ├── processed/
│   │   ├── drivers/
│   │   │   └── adcbuf.json
│   │   └── test_cases/
│   │       ├── adcbuf_general_0.json
│   │       └── adcbuf_board_specific_0.json
│   ├── board_support/
│   │   ├── cc23x0r5.json
│   │   ├── cc27xx.json
│   │   └── cc13xx_cc26xx.json
│   ├── parser.ts
│   └── process_configs.ts
├── drivers/
│   ├── adcbuf/
│   │   ├── test_cases/
│   │   │   ├── general/
│   │   │   │   ├── testcase_adcbuf_general.c
│   │   │   │   └── testcase_adcbuf_general.h
│   │   │   └── board_specific/
│   │   │       ├── cc23x0r5/
│   │   │       │   └── testcase_adcbuf_cc23x0r5.c
│   │   │       └── cc27xx/
│   │   │           └── testcase_adcbuf_cc27xx.c
│   │   ├── config/
│   │   │   ├── adcbuf.syscfg
│   │   │   └── adcbuf_ns.syscfg
│   │   └── source/
│   │       ├── ADCBuf.c
│   │       └── board_specific/
│   │           ├── ADCBufCC26XX.c
│   │           └── ADCBufLPF3.c
│   └── gpio/
│       └── [similar structure]
└── os_support/
    ├── tirtos7/
    │   └── [OS-specific test cases]
    ├── freertos/
    │   └── [OS-specific test cases]
    └── nortos/
        └── [OS-specific test cases]
```

## Components

### 1. Metadata

The metadata directory contains:

- **Project Configurations:** YAML files that define test configurations for each driver, including supported boards, operating systems, and file lists.
- **Board Support:** JSON files with board-specific information.
- **Processed Metadata:** JSON files generated from the project configurations.

### 2. Drivers

Each driver directory contains:

- **Test Cases:** Organized by general (driver-level) and board-specific tests.
- **Configuration:** Driver configuration files.
- **Source Files:** Driver implementation files.

### 3. OS Support

Contains OS-specific test cases and configurations.

## Usage

### Processing Project Configurations

To process project configurations and generate metadata:

```bash
cd generator/ti_test_examples/metadata
npm install js-yaml
npx ts-node process_configs.ts
```

This will:
1. Read all YAML files in the `project_configs` directory
2. Extract driver metadata and test case metadata
3. Generate JSON files in the `processed` directory

### Adding New Test Cases

1. Create a new test case file in the appropriate directory
2. Add the test case to the project configuration file
3. Run the process_configs.ts script to update metadata

### Integration with RAG Pipeline

The test cases in this repository serve as examples for the RAG unit test generator. The metadata provides context about:

- Driver functionality
- Board-specific features
- Test patterns and best practices
- Error handling approaches
- Initialization sequences

## Test Case Structure

TI test cases follow a consistent structure:

1. **License and Copyright Header:** Standard TI copyright notice
2. **Includes:** Driver and test framework headers
3. **Test Functions:** Individual test functions for specific features
4. **Main Function:** Entry point that initializes the board and runs tests

Each test case typically includes:

- Initialization and setup
- Resource allocation
- Test execution
- Validation of results
- Proper cleanup and teardown
- Error handling

## Board Support

Tests are organized by board family:
- cc23x0r5
- cc27xx
- cc13xx_cc26xx

Each board family may have specific testing requirements and capabilities.

## Adding New Drivers

To add support for a new driver:

1. Create a new project configuration file (e.g., `new_driver.yml`)
2. Define the supported boards, OS, and file lists
3. Create the directory structure for test cases
4. Add test case files
5. Run the metadata processor to update the metadata

## Contributing

When adding test cases, please follow the TI style and structure of existing tests. 