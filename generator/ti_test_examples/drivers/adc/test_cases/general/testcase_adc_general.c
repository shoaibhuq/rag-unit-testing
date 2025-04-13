/*
 * Copyright (c) 2020-2024, Texas Instruments Incorporated
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

#include <ti/drivers/ADC.h>
#include "ti_drivers_config.h"

#define NUM_ADC_CH (2U)
#define GPIO_HIGH  (3300)
#define GPIO_LOW   (0U)

/*
 * We only need two handles in the handleList. It's all we need to test
 * ADC_converChain().
 */
ADC_Handle adcHandle[NUM_ADC_CH] = {NULL};
ADC_Params adcParams;

/*******************************************************************************
 * Common Test Functions
 */

/*
 *  ======== commonTestOpen ========
 */
static void commonTestOpen(uint8_t adcIndex)
{
    /* Open ADC handle */
    adcHandle[adcIndex] = ADC_open(adcIndex, &adcParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(adcHandle[adcIndex], "Failed to open ADC Handle");
}

/*
 *  ======== commonTestClose ========
 */
static void commonTestClose(uint8_t adcIndex)
{
    /* Close ADC handle */
    ADC_close(adcHandle[adcIndex]);
    TEST_ASSERT_NOT_NULL_MESSAGE(adcHandle[adcIndex], "Failed to close ADC Handle");
}

/*******************************************************************************
 * ADC Convert Tests
 */

/*
 *  ======== test_convertSingleChannel ========
 */
void test_convertSingleChannel(uint8_t in_channelIndex, uint16_t in_refInputVoltage, uint16_t in_delta)
{
    uint16_t adcValue;
    uint16_t adcValueMicroVolt;
    int16_t res;

    /* Initialize the ADC driver */
    ADC_init();
    ADC_Params_init(&adcParams);

    /* Open ADC handle */
    commonTestOpen(in_channelIndex);

    res = ADC_convert(adcHandle[in_channelIndex], &adcValue);
    TEST_ASSERT_EQUAL(ADC_STATUS_SUCCESS, res);

    adcValueMicroVolt = (ADC_convertRawToMicroVolts(adcHandle[in_channelIndex], adcValue)) / 1000;

    TEST_ASSERT_EQUAL(ADC_STATUS_SUCCESS, res);
    TEST_ASSERT_INT_WITHIN(in_delta, in_refInputVoltage, adcValueMicroVolt);

    /* Close ADC handle */
    commonTestClose(in_channelIndex);
}

/*
 *  ======== test_convertChain ========
 */
void test_convertChain(uint8_t in_gpio1_output, uint8_t in_gpio2_output, uint16_t in_delta)
{
    int16_t res;
    uint16_t retValues[NUM_ADC_CH];
    uint16_t testValues[NUM_ADC_CH];
    uint16_t adcValueMicroVolt[NUM_ADC_CH];

    /* Initialize the ADC driver */
    ADC_init();
    ADC_Params_init(&adcParams);

    /* Open the two ADC handles that compose the handleList */
    commonTestOpen(CONFIG_ADC_0);
    commonTestOpen(CONFIG_ADC_1);

    /* Use value from GPIO to derive the appropiate comparison test value. */
    testValues[0] = ((bool)in_gpio1_output) ? GPIO_HIGH : GPIO_LOW;
    testValues[1] = ((bool)in_gpio2_output) ? GPIO_HIGH : GPIO_LOW;

    res = ADC_convertChain(adcHandle, retValues, NUM_ADC_CH);
    TEST_ASSERT_EQUAL(ADC_STATUS_SUCCESS, res);

    adcValueMicroVolt[0] = (ADC_convertRawToMicroVolts(adcHandle[0], retValues[0])) / 1000;
    adcValueMicroVolt[1] = (ADC_convertRawToMicroVolts(adcHandle[1], retValues[1])) / 1000;

    TEST_ASSERT_INT_WITHIN_MESSAGE(in_delta, testValues[0], adcValueMicroVolt[0], "Wrong ADC value");
    TEST_ASSERT_INT_WITHIN_MESSAGE(in_delta, testValues[1], adcValueMicroVolt[1], "Wrong ADC value");

    /* Close the two ADC handles that compose the handleList */
    commonTestClose(CONFIG_ADC_0);
    commonTestClose(CONFIG_ADC_1);
}
