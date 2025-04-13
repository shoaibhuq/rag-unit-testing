/*
 * Copyright (c) 2023-2024, Texas Instruments Incorporated
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

#include <ti/drivers/ADCBuf.h>

#include <ti/drivers/GPIO.h>
#include <ti/drivers/Power.h>

#include <ti/drivers/dpl/SemaphoreP.h>

#include "ti_drivers_config.h"

#include <ti/devices/DeviceFamily.h>
#include DeviceFamily_constructPath(inc/hw_ioc.h)
#include DeviceFamily_constructPath(inc/hw_adc.h)
#include DeviceFamily_constructPath(inc/hw_memmap.h)
#include DeviceFamily_constructPath(inc/hw_types.h)

#define NUM_ADC_CH               (2U)
#define GPIO_HIGH                (3300)
#define GPIO_LOW                 (0U)
#define MAX_SAMPLES_PER_BUFFER   (1024U)
#define SAMPLE_BUFFER_LENGTH     (MAX_SAMPLES_PER_BUFFER + 1U)
#define SAMPLE_BUFFER_SIZE       (SAMPLE_BUFFER_LENGTH * sizeof(uint16_t))
#define UVOLT_SAMPLE_BUFFER_SIZE (100U)
#define MAX_BUFFER_COUNT         (4U)

#define ADC_O_TEST1 (ADC_O_TEST0 + 4)

ADCBuf_Handle adcBufHandle;
ADCBuf_Conversion adcBufConversion;

SemaphoreP_Struct semaphoreStruct;
SemaphoreP_Struct syncPinSemaphoreStruct;

uint16_t sampleBuffers[2][SAMPLE_BUFFER_LENGTH];

uint32_t uVoltSampleBuffer[UVOLT_SAMPLE_BUFFER_SIZE];

/* Buffer to store all samples for processing after test. We don't have enough
 * time to process the samples during the test
 */
uint16_t finalSampleBuffer[MAX_SAMPLES_PER_BUFFER * MAX_BUFFER_COUNT];

volatile uint16_t *lastCompletedSampleBuffer = sampleBuffers[1];

/* DTB defines */
#if (DeviceFamily_PARENT == DeviceFamily_PARENT_CC23X0)
    #define IOC_DTBCFG_SVTSEL_ADC   (1 << IOC_DTBCFG_SVTSEL_S)
    #define IOC_DTBCFG_SVTSEL_CPUSS (4 << IOC_DTBCFG_SVTSEL_S)

    #define IOC_DTBCFG_ULLSEL_SVTIP (0 << IOC_DTBCFG_ULLSEL_S)
#endif

/*******************************************************************************
 * Common Test Functions
 */

/*
 *  ======== commonTestOpen ========
 */
static void commonTestOpen(void)
{
    SemaphoreP_Handle semaphoreHandle;
    semaphoreHandle = SemaphoreP_constructBinary(&semaphoreStruct, 0);
    TEST_ASSERT_NOT_NULL_MESSAGE(semaphoreHandle, "Failed to construct semaphoreStruct");

    semaphoreHandle = SemaphoreP_constructBinary(&syncPinSemaphoreStruct, 0);
    TEST_ASSERT_NOT_NULL_MESSAGE(semaphoreHandle, "Failed to construct syncPinSemaphoreStruct");
}

void adcBufCallbackOneShot(ADCBuf_Handle handle,
                           ADCBuf_Conversion *conversion,
                           void *completedADCBuffer,
                           uint32_t completedChannel,
                           int_fast16_t status)
{
    TEST_ASSERT_NOT_NULL_MESSAGE(handle, "Handle in adcBufCallback was NULL");
    TEST_ASSERT_NOT_NULL_MESSAGE(conversion, "Conversion pointer in adcBufCallback was NULL");
    TEST_ASSERT_NOT_NULL_MESSAGE(completedADCBuffer, "Buffer pointer in adcBufCallback was NULL");
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, status, "Status in adcBufCallback was not SUCCESS");

    /* Check that we did not overflow*/
    TEST_ASSERT_EQUAL_MESSAGE(0,
                              ((uint16_t *)completedADCBuffer)[conversion->samplesRequestedCount],
                              "Samples overflowed! Was expecting a 0 but got a sample instead!");

    GPIO_toggle(CONFIG_GPIO_RLED);

    SemaphoreP_post(&semaphoreStruct);

    GPIO_toggle(CONFIG_GPIO_RLED);
}

void adcBufCallbackContinuous(ADCBuf_Handle handle,
                              ADCBuf_Conversion *conversion,
                              void *completedADCBuffer,
                              uint32_t completedChannel,
                              int_fast16_t status)
{
    TEST_ASSERT_NOT_NULL_MESSAGE(handle, "Handle in adcBufCallback was NULL");
    TEST_ASSERT_NOT_NULL_MESSAGE(conversion, "Conversion pointer in adcBufCallback was NULL");
    TEST_ASSERT_NOT_NULL_MESSAGE(completedADCBuffer, "Buffer pointer in adcBufCallback was NULL");
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, status, "Status in adcBufCallback was not SUCCESS");

    TEST_ASSERT_TRUE_MESSAGE(completedADCBuffer == sampleBuffers[0] || completedADCBuffer == sampleBuffers[1],
                             "Callback did not return either of the sample buffers.");
    TEST_ASSERT_NOT_EQUAL_MESSAGE(completedADCBuffer,
                                  lastCompletedSampleBuffer,
                                  "Callback returned same completed buffer twice.");

    /* Check that we did not overflow*/
    TEST_ASSERT_EQUAL_MESSAGE(0,
                              ((uint16_t *)completedADCBuffer)[conversion->samplesRequestedCount],
                              "Samples overflowed! Was expecting a 0 but got a sample instead!");

    GPIO_toggle(CONFIG_GPIO_OUTPUT_SYNC);

    lastCompletedSampleBuffer = completedADCBuffer;

    SemaphoreP_post(&semaphoreStruct);
}

void gpioCallback(uint_least8_t index)
{
    if (index == CONFIG_GPIO_INPUT_SYNC)
    {
        SemaphoreP_post(&syncPinSemaphoreStruct);
    }
}

/*!
 * @brief Adjust samples, convert to uVolt, and validate both (in mV)
 *
 * @param [in] sampleBuffer Input buffer of length expectedSampleCount + 1
 * @param expectedSampleCount Expected number of samples
 * @param acceptedDelta Delta in mV acceptable vs @c refInputVoltage
 * @param refInputVoltage Voltage in mV used as reference
 */
void adjustConvertAndValidateSamples(uint16_t sampleBuffer[],
                                     size_t expectedSampleCount,
                                     uint32_t acceptedDelta,
                                     uint32_t refInputVoltage,
                                     uint32_t adcChannel)
{

    for (uint32_t i = 0; i < expectedSampleCount; i += UVOLT_SAMPLE_BUFFER_SIZE)
    {
        uint32_t validationLength = expectedSampleCount - i;
        if (validationLength > UVOLT_SAMPLE_BUFFER_SIZE)
        {
            validationLength = UVOLT_SAMPLE_BUFFER_SIZE;
        }

        int_fast16_t res = ADCBuf_adjustRawValues(adcBufHandle, &sampleBuffer[i], validationLength, 0);
        TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_adjustRawValues failed.");

        res = ADCBuf_convertAdjustedToMicroVolts(adcBufHandle,
                                                 adcChannel,
                                                 &sampleBuffer[i],
                                                 uVoltSampleBuffer,
                                                 validationLength);
        TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_convertAdjustedToMicroVolts failed.");

        /* Check that all samples are within range */
        for (uint32_t j = 0; j < validationLength; j++)
        {
            TEST_ASSERT_INT_WITHIN_MESSAGE(acceptedDelta,
                                           refInputVoltage,
                                           uVoltSampleBuffer[j] / 1000,
                                           "Sample not in expected range");
        }

        /* Zero out buffers */
        memset(&sampleBuffer[i], 0x00, validationLength * sizeof(sampleBuffer[0]));

        memset(uVoltSampleBuffer, 0x00, validationLength * sizeof(uVoltSampleBuffer[0]));
    }
}

/**
 * @brief Open the driver, setup a conversion, and start it
 *
 * @param samplingFrequency Sampling frequency to sample at
 * @param samplesRequestedCount Number of samples to take
 * @param returnMode BLOCKING vs CALLBACK
 * @param recurrentMode CONTINUOUS vs ONE_SHOT
 * @param callbackFxn Callback fxn to call in callback mode
 */
void setupAndConvert(uint32_t samplingFrequency,
                     size_t samplesRequestedCount,
                     ADCBuf_Return_Mode returnMode,
                     ADCBuf_Recurrence_Mode recurrentMode,
                     ADCBuf_Callback callbackFxn,
                     uint32_t adcChannel)
{
    ADCBuf_Params adcBufParams;

    /* Initialize the ADCBuf driver */
    ADCBuf_init();
    ADCBuf_Params_init(&adcBufParams);
    adcBufParams.samplingFrequency = samplingFrequency;
    adcBufParams.returnMode        = returnMode;
    adcBufParams.recurrenceMode    = recurrentMode;
    adcBufParams.callbackFxn       = callbackFxn;
    adcBufParams.blockingTimeout   = ~0;

    /* Open ADCBuf handle */
    adcBufHandle = ADCBuf_open(CONFIG_ADCBUF_0, &adcBufParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(adcBufHandle, "Failed to open ADCBuf Handle");

    TEST_ASSERT_LESS_THAN_MESSAGE(SAMPLE_BUFFER_LENGTH,
                                  samplesRequestedCount,
                                  "The test requested too many samples for the buffer to hold including a zero "
                                  "canary.");

    /* Configure conversion */
    adcBufConversion.sampleBuffer          = sampleBuffers[0];
    adcBufConversion.sampleBufferTwo       = sampleBuffers[1];
    adcBufConversion.samplesRequestedCount = samplesRequestedCount;
    adcBufConversion.adcChannel            = adcChannel;

    /* Start the conversion */
    int_fast16_t res = ADCBuf_convert(adcBufHandle, &adcBufConversion, 1);
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_convert failed.");
}

/*******************************************************************************
 * ADCBuf Convert Tests
 */

/*
 *  ======== test_convertOneShot ========
 */
void test_convertOneShot(uint8_t in_returnMode,
                         uint32_t in_samplingFrequency,
                         uint16_t in_samplesRequestedCount,
                         uint32_t in_refInputVoltage,
                         uint32_t in_delta,
                         uint32_t in_adcChannel)
{
    /* Setup semaphores etc. */
    commonTestOpen();

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    in_returnMode,
                    ADCBuf_RECURRENCE_MODE_ONE_SHOT,
                    adcBufCallbackOneShot,
                    in_adcChannel);

    /* If we are in callback mode, wait until we get the callback */
    if (in_returnMode == ADCBuf_RETURN_MODE_CALLBACK)
    {
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);
    }

    adjustConvertAndValidateSamples(sampleBuffers[0],
                                    in_samplesRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);
}

/*
 *  ======== test_convertOneShotTwice ========
 */
void test_convertOneShotTwice(uint8_t in_returnMode,
                              uint32_t in_samplingFrequency,
                              uint16_t in_samplesRequestedCount,
                              uint32_t in_refInputVoltage,
                              uint32_t in_delta,
                              uint32_t in_adcChannel)
{
    int_fast16_t res;

    /* Setup semaphores etc. */
    commonTestOpen();

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    in_returnMode,
                    ADCBuf_RECURRENCE_MODE_ONE_SHOT,
                    adcBufCallbackOneShot,
                    in_adcChannel);

    /* If we are in callback mode, wait until we get the callback */
    if (in_returnMode == ADCBuf_RETURN_MODE_CALLBACK)
    {
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);
    }

    adjustConvertAndValidateSamples(sampleBuffers[0],
                                    in_samplesRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Start the conversion */
    res = ADCBuf_convert(adcBufHandle, &adcBufConversion, 1);
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_convert failed.");

    /* If we are in callback mode, wait until we get the callback */
    if (in_returnMode == ADCBuf_RETURN_MODE_CALLBACK)
    {
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);
    }

    adjustConvertAndValidateSamples(sampleBuffers[0],
                                    in_samplesRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);
}

/*
 *  ======== test_convertAndReopenOneShot ========
 */
void test_convertAndReopenOneShot(uint8_t in_returnMode,
                                  uint32_t in_samplingFrequency,
                                  uint16_t in_samplesRequestedCount,
                                  uint32_t in_refInputVoltage,
                                  uint32_t in_delta,
                                  uint32_t in_adcChannel)
{
    /* Setup semaphores etc. */
    commonTestOpen();

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    in_returnMode,
                    ADCBuf_RECURRENCE_MODE_ONE_SHOT,
                    adcBufCallbackOneShot,
                    in_adcChannel);

    /* If we are in callback mode, wait until we get the callback */
    if (in_returnMode == ADCBuf_RETURN_MODE_CALLBACK)
    {
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);
    }

    adjustConvertAndValidateSamples(sampleBuffers[0],
                                    in_samplesRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    in_returnMode,
                    ADCBuf_RECURRENCE_MODE_ONE_SHOT,
                    adcBufCallbackOneShot,
                    in_adcChannel);

    /* If we are in callback mode, wait until we get the callback */
    if (in_returnMode == ADCBuf_RETURN_MODE_CALLBACK)
    {
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);
    }

    adjustConvertAndValidateSamples(sampleBuffers[0],
                                    in_samplesRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);
}

/*
 *  ======== test_convertContinuousTwice ========
 */
void test_convertContinuousTwice(uint16_t in_buffersRequestedCount,
                                 uint32_t in_samplingFrequency,
                                 uint16_t in_samplesRequestedCount,
                                 uint32_t in_refInputVoltage,
                                 uint32_t in_delta,
                                 uint32_t in_adcChannel)
{
    int_fast16_t res;

    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(MAX_BUFFER_COUNT,
                                      in_buffersRequestedCount,
                                      "The requested buffer count it not supported by the test FW");

    /* Setup semaphores etc. */
    commonTestOpen();

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    ADCBuf_RETURN_MODE_CALLBACK,
                    ADCBuf_RECURRENCE_MODE_CONTINUOUS,
                    adcBufCallbackContinuous,
                    in_adcChannel);

    for (uint32_t i = 0; i < in_buffersRequestedCount; i++)
    {
        /* Wait until we get the callback */
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);

        GPIO_toggle(CONFIG_GPIO_GLED);

        /* Copy data to permanent buffer */
        memcpy(&finalSampleBuffer[in_samplesRequestedCount * i],
               (uint16_t *)lastCompletedSampleBuffer,
               in_samplesRequestedCount * sizeof(lastCompletedSampleBuffer[0]));

        /* Zero out buffer */
        memset((uint16_t *)lastCompletedSampleBuffer,
               0x00,
               in_samplesRequestedCount * sizeof(lastCompletedSampleBuffer[0]));

        GPIO_toggle(CONFIG_GPIO_GLED);
    }

    /* Stop the continuous conversion */
    res = ADCBuf_convertCancel(adcBufHandle);
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_convertCancel failed.");

    adjustConvertAndValidateSamples((uint16_t *)finalSampleBuffer,
                                    in_samplesRequestedCount * in_buffersRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Start the conversion */
    res = ADCBuf_convert(adcBufHandle, &adcBufConversion, 1);
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_convert failed.");

    for (uint32_t i = 0; i < in_buffersRequestedCount; i++)
    {
        /* Wait until we get the callback */
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);

        GPIO_toggle(CONFIG_GPIO_GLED);

        /* Copy data to permanent buffer */
        memcpy(&finalSampleBuffer[in_samplesRequestedCount * i],
               (uint16_t *)lastCompletedSampleBuffer,
               in_samplesRequestedCount * sizeof(lastCompletedSampleBuffer[0]));

        /* Zero out buffer */
        memset((uint16_t *)lastCompletedSampleBuffer,
               0x00,
               in_samplesRequestedCount * sizeof(lastCompletedSampleBuffer[0]));

        GPIO_toggle(CONFIG_GPIO_GLED);
    }

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);

    adjustConvertAndValidateSamples((uint16_t *)finalSampleBuffer,
                                    in_samplesRequestedCount * in_buffersRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);
}

/*
 *  ======== test_convertContinuous ========
 */
void test_convertContinuous(uint16_t in_buffersRequestedCount,
                            uint32_t in_samplingFrequency,
                            uint16_t in_samplesRequestedCount,
                            uint32_t in_refInputVoltage,
                            uint32_t in_delta,
                            uint32_t in_adcChannel)
{
    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(MAX_BUFFER_COUNT,
                                      in_buffersRequestedCount,
                                      "The requested buffer count it not supported by the test FW");

    int_fast16_t res;

    /* Setup semaphores etc. */
    commonTestOpen();

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    ADCBuf_RETURN_MODE_CALLBACK,
                    ADCBuf_RECURRENCE_MODE_CONTINUOUS,
                    adcBufCallbackContinuous,
                    in_adcChannel);

    for (uint32_t i = 0; i < in_buffersRequestedCount; i++)
    {
        /* Wait until we get the callback */
        SemaphoreP_pend(&semaphoreStruct, SemaphoreP_WAIT_FOREVER);

        GPIO_toggle(CONFIG_GPIO_GLED);

        /* Copy data to permanent buffer */
        memcpy(&finalSampleBuffer[in_samplesRequestedCount * i],
               (uint16_t *)lastCompletedSampleBuffer,
               in_samplesRequestedCount * sizeof(lastCompletedSampleBuffer[0]));

        /* Zero out buffer */
        memset((uint16_t *)lastCompletedSampleBuffer,
               0x00,
               in_samplesRequestedCount * sizeof(lastCompletedSampleBuffer[0]));

        GPIO_toggle(CONFIG_GPIO_GLED);
    }

    /* Stop the continuous conversion */
    res = ADCBuf_convertCancel(adcBufHandle);
    TEST_ASSERT_EQUAL_MESSAGE(ADCBuf_STATUS_SUCCESS, res, "ADCBuf_convertCancel failed.");

    adjustConvertAndValidateSamples((uint16_t *)finalSampleBuffer,
                                    in_samplesRequestedCount * in_buffersRequestedCount,
                                    in_delta,
                                    in_refInputVoltage,
                                    in_adcChannel);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);
}

/*
 *  ======== test_samplingFrequency ========
 */
void test_samplingFrequency(uint32_t in_samplingFrequency, uint32_t in_adcChannel, uint32_t in_samplesRequestedCount)
{
#if (DeviceFamily_ID == DeviceFamily_ID_CC23X0R5) || (DeviceFamily_ID == DeviceFamily_ID_CC27XX)
    /* Setup semaphores etc. */
    commonTestOpen();

    GPIO_setConfig(CONFIG_GPIO_INPUT_SYNC, GPIO_CFG_INPUT | GPIO_CFG_IN_INT_FALLING);
    GPIO_setCallback(CONFIG_GPIO_INPUT_SYNC, gpioCallback);
    GPIO_enableInt(CONFIG_GPIO_INPUT_SYNC);

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    ADCBuf_RETURN_MODE_CALLBACK,
                    ADCBuf_RECURRENCE_MODE_CONTINUOUS,
                    adcBufCallbackContinuous,
                    in_adcChannel);

    /* Set up DTB to output ADC sample signal */

    /* DTB0: LATCH_RESULT
     * DTB1: EOC (DIO22 used for UART RX)
     * DTB2: SAMPLE
     * DTB3: TRIGGER
     * DTB4: EOS
     */
    HWREG(ADC_BASE + ADC_O_TEST1) = 8;

    #if (DeviceFamily_ID == DeviceFamily_ID_CC23X0R5)
    /* Select ADC DTB with SVT signals mux, select SVT DTB signals with ULL signals mux, map [15:13] to [15:13] (no
     * mod), do not divide DTB0
     */
    HWREG(IOC_BASE + IOC_O_DTBCFG) = IOC_DTBCFG_SVTSEL_ADC | IOC_DTBCFG_ULLSEL_SVTIP | IOC_DTBCFG_PADSEL_DTB15TO13 |
                                     IOC_DTBCFG_DTB0DIV_DIS;

    /* Select DTB for DIO8 (DTB3) */
    HWREG(IOC_BASE + IOC_O_IOC8) |= 7; /* TRIGGER */

    /* Select DTB for DIO1 (DTB2) */
    HWREG(IOC_BASE + IOC_O_IOC1) |= 7; /* SAMPLE */

    #elif (DeviceFamily_ID == DeviceFamily_ID_CC27XX)
    /* Select ADC DTB with SVT signals mux, select SVT DTB signals with ULL signals mux, map [2:0] to [2:0] (no
     * mod), do not divide DTB0
     */
    HWREG(IOC_BASE + IOC_O_DTBCFG) = IOC_DTBCFG_SVTSEL_ADC | IOC_DTBCFG_ULLSEL_SVTIP | (0 << IOC_DTBCFG_PADSEL_S) |
                                     IOC_DTBCFG_DTB0DIVEN_DIS;

    HWREG(IOC_BASE + IOC_O_DTBMUXCFG1) = IOC_DTBMUXCFG1_DTBL3SEL0_VAL0 | IOC_DTBMUXCFG1_DTBL2SEL0_VAL0 | /* ULL signal
                                                                                                            mux [3:0] to
                                                                                                            DTB [3:0] */
                                         IOC_DTBMUXCFG1_DTBL3SEL1_VAL1 | IOC_DTBMUXCFG1_DTBL2SEL1_VAL1;  /* ULL signal
                                                                                                            mux [7:4] to
                                                                                                            DTB [7:4] */

    /* Select DTB for DIO20 (DTB3) */
    HWREG(IOC_BASE + IOC_O_IOC20) |= 7; /* TRIGGER */

    /* Select DTB for DIO21 (DTB2) */
    HWREG(IOC_BASE + IOC_O_IOC21) |= 7; /* SAMPLE */

    #else
        #error "Missing code to configure DTB"
    #endif

    /* Enable DTB output for DTB2 and DTB3 */
    HWREG(IOC_BASE + IOC_O_DTBOE) = (1 << 2) | (1 << 3);

    /* Continue conversion while CONFIG_GPIO_INPUT_SYNC is high */
    SemaphoreP_pend(&syncPinSemaphoreStruct, SemaphoreP_WAIT_FOREVER);

    /* Stop the continuous conversion */
    ADCBuf_convertCancel(adcBufHandle);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);
#else
    TEST_FAIL_MESSAGE("This test case has not been implemented for this device yet")
#endif
}

/*
 *  ======== test_cpuLoad ========
 */
void test_cpuLoad(uint32_t in_samplingFrequency, uint16_t in_samplesRequestedCount, uint32_t in_adcChannel)
{
#if (DeviceFamily_ID == DeviceFamily_ID_CC23X0R5) || (DeviceFamily_ID == DeviceFamily_ID_CC27XX)
    /* Setup semaphores etc. */
    commonTestOpen();

    GPIO_setConfig(CONFIG_GPIO_INPUT_SYNC, GPIO_CFG_INPUT | GPIO_CFG_IN_INT_FALLING);
    GPIO_setCallback(CONFIG_GPIO_INPUT_SYNC, gpioCallback);
    GPIO_enableInt(CONFIG_GPIO_INPUT_SYNC);

    setupAndConvert(in_samplingFrequency,
                    in_samplesRequestedCount,
                    ADCBuf_RETURN_MODE_CALLBACK,
                    ADCBuf_RECURRENCE_MODE_CONTINUOUS,
                    adcBufCallbackContinuous,
                    in_adcChannel);

    /* Set up DTB to output cpuss_sleep signal*/

    /* DTB0: cpuss_halt
     * DTB1: cpuss_lockup
     * DTB2: cpuss_sysresetreq
     * DTB3: cpuss_sleep
     * DTB4: cpuss_dsleep
     */

    #if (DeviceFamily_ID == DeviceFamily_ID_CC23X0R5)
    /* Select CPUSS DTB with SVT signals mux, select SVT DTB signals with ULL signals mux, map [15:13] to [15:13] (no
     * mod), do not divide DTB0
     */
    HWREG(IOC_BASE + IOC_O_DTBCFG) = IOC_DTBCFG_SVTSEL_CPUSS | IOC_DTBCFG_ULLSEL_SVTIP | IOC_DTBCFG_PADSEL_DTB15TO13 |
                                     IOC_DTBCFG_DTB0DIV_DIS;

    /* Select DTB for DIO8 (DTB3) */
    HWREG(IOC_BASE + IOC_O_IOC8) |= 7; /* cpuss_sleep */

    #elif (DeviceFamily_ID == DeviceFamily_ID_CC27XX)
    /* Select CPUSS DTB with SVT signals mux, select SVT DTB signals with ULL signals mux, map [2:0] to [2:0] (no
     * mod), do not divide DTB0
     */
    HWREG(IOC_BASE + IOC_O_DTBCFG) = IOC_DTBCFG_SVTSEL_CPUSS | IOC_DTBCFG_ULLSEL_SVTIP | (0 << IOC_DTBCFG_PADSEL_S) |
                                     IOC_DTBCFG_DTB0DIVEN_DIS;

    HWREG(IOC_BASE + IOC_O_DTBMUXCFG1) = IOC_DTBMUXCFG1_DTBL3SEL0_VAL0 | IOC_DTBMUXCFG1_DTBL2SEL0_VAL0 | /* ULL signal
                                                                                                            mux [3:0] to
                                                                                                            DTB [3:0] */
                                         IOC_DTBMUXCFG1_DTBL3SEL1_VAL1 | IOC_DTBMUXCFG1_DTBL2SEL1_VAL1;  /* ULL signal
                                                                                                            mux [7:4] to
                                                                                                            DTB [7:4] */

    /* Select DTB for DIO20 (DTB3) */
    HWREG(IOC_BASE + IOC_O_IOC20) |= 7; /* cpuss_sleep */
    #else
        #error "Missing code to configure DTB"
    #endif

    /* Enable DTB output for DTB3 */
    HWREG(IOC_BASE + IOC_O_DTBOE) = (1 << 3);

    /* Continue conversion while CONFIG_GPIO_INPUT_SYNC is high */
    SemaphoreP_pend(&syncPinSemaphoreStruct, SemaphoreP_WAIT_FOREVER);

    /* Stop the continuous conversion */
    ADCBuf_convertCancel(adcBufHandle);

    /* Close ADCBuf handle */
    ADCBuf_close(adcBufHandle);
#else
    TEST_FAIL_MESSAGE("This test case has not been implemented for this device yet")
#endif
}

#warning "Add test case for using ADC driver at the same time as ADC buf driver"