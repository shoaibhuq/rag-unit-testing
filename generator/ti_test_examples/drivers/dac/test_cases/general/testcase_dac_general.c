/*
 * Copyright (c) 2021, Texas Instruments Incorporated
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * *  Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * *  Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * *  Neither the name of Texas Instruments Incorporated nor the names of
 *    its contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include <unity/unity.h>

#include <stdlib.h>

#include <ti/drivers/DAC.h>
#include "ti_drivers_config.h"

#define NUM_DAC_CH 4U

DAC_Handle dacHandle[NUM_DAC_CH] = {NULL};
DAC_Params dacParams;

/*******************************************************************************
 * Common Test Functions
 */

/*
 *  ======== common_test_open ========
 */
static void common_test_open(uint8_t channelIndex)
{
    /* Open DAC handle */
    dacHandle[channelIndex] = DAC_open(channelIndex, &dacParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(dacHandle[channelIndex], "Failed to open DAC Handle");
}

/*
 *  ======== common_test_close ========
 */
static void common_test_close(uint8_t channelIndex)
{
    /* Close DAC handle */
    DAC_close(dacHandle[channelIndex]);
    TEST_ASSERT_NOT_NULL_MESSAGE(dacHandle[channelIndex], "Failed to close DAC Handle");
}

/*
 *  ======== common_enable_dac ========
 */
void common_enable_dac(uint8_t channelIndex)
{
    int16_t statusEnable;

    /* Initialize the DAC driver */
    DAC_init();
    DAC_Params_init(&dacParams);

    /* Open DAC handle */
    common_test_open(channelIndex);

    /* Enable DAC handle */
    statusEnable = DAC_enable(dacHandle[channelIndex]);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusEnable);
}

/*
 *  ======== common_disable_dac ========
 */
void common_disable_dac(uint8_t channelIndex)
{
    int16_t statusEnable;

    /* Disable DAC handle */
    statusEnable = DAC_disable(dacHandle[channelIndex]);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusEnable);

    /* Close DAC handle */
    common_test_close(channelIndex);
}

/*******************************************************************************
 * API Tests
 */

/*
 *  ======== test_out_of_range ========
 */
void test_out_of_range(uint8_t in_channelIndex, uint32_t in_voltage)
{
    int16_t statusOutput;

    /* Initialize and enable DAC */
    common_enable_dac(in_channelIndex);

    /* Set voltage */
    statusOutput = DAC_setVoltage(dacHandle[in_channelIndex], in_voltage);
    TEST_ASSERT_EQUAL(DAC_STATUS_INVALID, statusOutput);

    /* Disable and close DAC */
    common_disable_dac(in_channelIndex);
}

/*
 *  ======== test_open_twice ========
 */
void test_open_twice(void)
{
    /* Initialize the DAC driver */
    DAC_init();
    DAC_Params_init(&dacParams);

    /* This will set-up and open the driver a first time */
    dacHandle[0] = DAC_open(0, &dacParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(dacHandle[0], "Failed to open DAC Handle");

    /* Attempt to open twice, should fail */
    dacHandle[1] = DAC_open(0, &dacParams);
    TEST_ASSERT_NULL(dacHandle[1]);

    /* This will clean-up everything */
    common_test_close(0);
}

/*
 *  ======== test_set_code_while_disabled ========
 */
void test_set_code_while_disabled(uint8_t in_channelIndex, uint32_t in_code)
{
    int16_t statusOutput;

    /* Initialize the DAC driver */
    DAC_init();
    DAC_Params_init(&dacParams);

    /* This will set-up and open the driver */
    common_test_open(in_channelIndex);

    /* Set code before DAC has been enabled */
    statusOutput = DAC_setCode(dacHandle[in_channelIndex], (uint8_t)in_code);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusOutput);

    /* This will clean-up everything */
    common_test_close(in_channelIndex);
}

/*
 *  ======== test_open_default_params ========
 */
void test_open_default_params(void)
{

    DAC_Params *dacParamsEmpty = NULL;

    /* Initialize the DAC driver */
    DAC_init();

    /* Attempt to open handle without parameters */
    dacHandle[0] = DAC_open(CONFIG_DAC_0, dacParamsEmpty);
    TEST_ASSERT_NOT_NULL(dacHandle[0]);

    /* This will clean-up everything */
    common_test_close(0);
}

/*
 *  ======== test_dac_ownership ========
 */
void test_dac_ownership(void)
{
    int16_t statusEnable;

    /* Initialize the DAC driver */
    DAC_init();
    DAC_Params_init(&dacParams);

    /* Open first handle */
    dacHandle[0] = DAC_open(CONFIG_DAC_0, &dacParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(dacHandle[0], "Failed to open DAC Handle");

    /* Open second handle */
    dacHandle[1] = DAC_open(CONFIG_DAC_1, &dacParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(dacHandle[1], "Failed to open DAC Handle");

    /* Enable DAC for first handle */
    statusEnable = DAC_enable(dacHandle[0]);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusEnable);

    /* Attempt to enable DAC for second handle */
    statusEnable = DAC_enable(dacHandle[1]);
    TEST_ASSERT_EQUAL(DAC_STATUS_INUSE, statusEnable);

    /* This will clean-up everything */
    common_test_close(CONFIG_DAC_0);
    common_test_close(CONFIG_DAC_1);
}

/*
 *  ======== test_set_voltage_while_disabled ========
 */
void test_set_voltage_while_disabled(uint8_t in_channelIndex, uint32_t in_voltage)
{
    int16_t statusOutput;

    /* Initialize the DAC driver */
    DAC_init();
    DAC_Params_init(&dacParams);

    /* This will set-up and open the driver */
    common_test_open(in_channelIndex);

    /* Set output voltage before DAC has been enabled */
    statusOutput = DAC_setVoltage(dacHandle[in_channelIndex], in_voltage);
    TEST_ASSERT_EQUAL(DAC_STATUS_ERROR, statusOutput);

    /* This will clean-up everything */
    common_test_close(in_channelIndex);
}

/*
 *  ======== test_set_reference_source ========
 */
void test_set_reference_source(uint8_t in_channelIndex)
{
    int16_t statusEnable;

    /* Initialize the DAC driver */
    DAC_init();
    DAC_Params_init(&dacParams);

    /* Open DAC handle */
    common_test_open(in_channelIndex);

    /* Enable DAC handle */
    statusEnable = DAC_enable(dacHandle[in_channelIndex]);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusEnable);
}

/*******************************************************************************
 * DAC Conversion Tests
 */

/*
 *  ======== test_set_code ========
 */

void test_set_code(uint8_t in_channelIndex, uint32_t in_dacCode)
{
    int16_t statusCode;

    /* Initialize and enable DAC */
    common_enable_dac(in_channelIndex);
    /* Set code */
    statusCode = DAC_setCode(dacHandle[in_channelIndex], in_dacCode);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusCode);
}

/*
 *  ======== test_set_voltage ========
 */
void test_set_voltage(uint8_t in_channelIndex, uint32_t in_voltage)
{
    int16_t statusOutput;

    /* Initialize and enable DAC */
    common_enable_dac(in_channelIndex);

    /* Set voltage */
    statusOutput = DAC_setVoltage(dacHandle[in_channelIndex], in_voltage);
    TEST_ASSERT_EQUAL(DAC_STATUS_SUCCESS, statusOutput);
}

/*
 *  ======== test_disable_dac ========
 */
void test_disable_dac(uint8_t in_channelIndex)
{
    /* Disable and close DAC handle*/
    common_disable_dac(in_channelIndex);
}
