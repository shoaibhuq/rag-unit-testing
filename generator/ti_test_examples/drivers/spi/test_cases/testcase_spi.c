/*
 * Copyright (c) 2021-2024, Texas Instruments Incorporated
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

#include <ti/devices/DeviceFamily.h>
#include <unity/unity.h>
#include <ti/drivers/SPI.h>
#include "testcase_spi_common.h"
#include "ti_drivers_config.h"

#if (DeviceFamily_PARENT == DeviceFamily_PARENT_CC13X4_CC26X3_CC26X4)
    #include <ti/drivers/spi/SPICC26X4DMA.h>
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_ENABLE  SPICC26X4DMA_CMD_RETURN_PARTIAL_ENABLE
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_DISABLE SPICC26X4DMA_CMD_RETURN_PARTIAL_DISABLE
    #define DEV_SPECIFIC_CMD_SET_MANUAL             SPICC26X4DMA_CMD_SET_MANUAL
    #define DEV_SPECIFIC_CMD_MANUAL_START           SPICC26X4DMA_CMD_MANUAL_START
    #define DEV_SPECIFIC_CMD_CLR_MANUAL             SPICC26X4DMA_CMD_CLR_MANUAL
#elif (DeviceFamily_PARENT == DeviceFamily_PARENT_CC23X0) || (DeviceFamily_PARENT == DeviceFamily_PARENT_CC27XX)
    #include <ti/drivers/spi/SPILPF3DMA.h>
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_ENABLE  SPILPF3DMA_CMD_RETURN_PARTIAL_ENABLE
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_DISABLE SPILPF3DMA_CMD_RETURN_PARTIAL_DISABLE
    #define DEV_SPECIFIC_CMD_SET_MANUAL             SPILPF3DMA_CMD_SET_MANUAL
    #define DEV_SPECIFIC_CMD_MANUAL_START           SPILPF3DMA_CMD_MANUAL_START
    #define DEV_SPECIFIC_CMD_CLR_MANUAL             SPILPF3DMA_CMD_CLR_MANUAL
#elif (DeviceFamily_PARENT == DeviceFamily_PARENT_CC13X2_CC26X2 || \
       DeviceFamily_PARENT == DeviceFamily_PARENT_CC13X1_CC26X1)
    #include <ti/drivers/spi/SPICC26X2DMA.h>
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_ENABLE  SPICC26X2DMA_CMD_RETURN_PARTIAL_ENABLE
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_DISABLE SPICC26X2DMA_CMD_RETURN_PARTIAL_DISABLE
    #define DEV_SPECIFIC_CMD_SET_MANUAL             SPICC26X2DMA_CMD_SET_MANUAL
    #define DEV_SPECIFIC_CMD_MANUAL_START           SPICC26X2DMA_CMD_MANUAL_START
    #define DEV_SPECIFIC_CMD_CLR_MANUAL             SPICC26X2DMA_CMD_CLR_MANUAL
#elif (DeviceFamily_PARENT == DeviceFamily_PARENT_CC35XX)
    #include <ti/drivers/spi/SPIWFF3DMA.h>
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_ENABLE  SPIWFF3DMA_CMD_RETURN_PARTIAL_ENABLE
    #define DEV_SPECIFIC_CMD_RETURN_PARTIAL_DISABLE SPIWFF3DMA_CMD_RETURN_PARTIAL_DISABLE
    #define DEV_SPECIFIC_CMD_SET_MANUAL             SPIWFF3DMA_CMD_SET_MANUAL
    #define DEV_SPECIFIC_CMD_MANUAL_START           SPIWFF3DMA_CMD_MANUAL_START
    #define DEV_SPECIFIC_CMD_CLR_MANUAL             SPIWFF3DMA_CMD_CLR_MANUAL
#else
    #error "No device family found"
#endif

/*
 *  ======== test_configureIndependentInstances ========
 */
void test_configureIndependentInstances(void)
{

    /* Initialize the SPI driver */
    SPI_init();

    /* Initialize params structs for the first instance */
    SPI_Params_init(&spiParams);

    /* Configure first instance as Controller in blocking mode */
    spiParams.transferMode = SPI_MODE_BLOCKING;
    spiParams.mode         = SPI_CONTROLLER;

    /* This will set-up and open the driver using CONFIG_SPI_0 */
    spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NOT_NULL(spiHandle);

/* CC13X1/CC26X1, CC26X3, CC23X0R2/CC23X0R5 do not support multiple SPI instances
 * meaning that CONFIG_SPI_1 won't exist. */
#if ((DeviceFamily_PARENT != DeviceFamily_PARENT_CC13X1_CC26X1) && (DeviceFamily_ID != DeviceFamily_ID_CC26X3) && \
     (DeviceFamily_PARENT != DeviceFamily_PARENT_CC23X0))

    #ifdef CONFIG_SPI_1

    SPI_Handle spiHandle1 = NULL;
    SPI_Params spiParams1;

    /* Initialize params structs for the second instance */
    SPI_Params_init(&spiParams1);

    /* Configure second instance as Peripheral in callback mode */
    spiParams1.transferMode        = SPI_MODE_CALLBACK;
    spiParams1.mode                = SPI_PERIPHERAL;
    spiParams1.transferCallbackFxn = transferCallback;

    spiHandle1 = SPI_open(CONFIG_SPI_1, &spiParams1);
    TEST_ASSERT_NOT_NULL(spiHandle1);

    if (spiHandle1 != NULL)
    {
        SPI_close(spiHandle1);
        spiHandle1 = NULL;
    }

    #endif
#endif

    spiCleanup();
}

/*
 *  ======== test_peripheralReturnPartial ========
 */
void test_peripheralReturnPartial(uint32_t in_numFrames, uint32_t *out_txBufferAddr, uint32_t *out_rxBufferAddr)
{
    uint32_t customArg = DUMMY_TRANSACTION_ID;

    /* Enable RETURN_PARTIAL */
    SPI_control(spiHandle, DEV_SPECIFIC_CMD_RETURN_PARTIAL_ENABLE, NULL);

    setupSpiTransaction(&spiTransaction, in_numFrames, txBuf, rxBuf, &customArg);

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiTransaction);

    if (spiParams.transferMode == SPI_MODE_CALLBACK)
    {
        /* Wait for the callback to execute signaling that the transaction is over. */
        SemaphoreP_pend(callbackSemHandle, SemaphoreP_WAIT_FOREVER);
    }

    TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer");

    /* Disable RETURN_PARTIAL */
    SPI_control(spiHandle, DEV_SPECIFIC_CMD_RETURN_PARTIAL_DISABLE, NULL);

    *out_txBufferAddr = (uint32_t)txBuf;
    *out_rxBufferAddr = (uint32_t)rxBuf;

    spiCleanup();
}

/*
 *  ======== test_peripheralReturnPartialQueued ========
 */
void test_peripheralReturnPartialQueued(uint32_t in_numFrames,
                                        uint32_t in_bitRate,
                                        uint32_t in_transCount1,
                                        uint32_t *out_txBufferAddr,
                                        uint32_t *out_rxBufferAddr)
{
    /* We'll use a specific set of SPI transactions for this test */
    SPI_Transaction spiQueuedTransfer1;
    SPI_Transaction spiQueuedTransfer2;
    int_fast16_t controlStatus;

    SPI_init();
    SPI_Params_init(&spiParams);
    spiParams.dataSize            = 8;
    spiParams.frameFormat         = SPI_POL1_PHA1;
    spiParams.bitRate             = in_bitRate;
    spiParams.transferMode        = SPI_MODE_CALLBACK;
    spiParams.mode                = SPI_PERIPHERAL;
    spiParams.transferCallbackFxn = transferPartialQueuedCallback;

    spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(spiHandle, "SPI driver failed to open.");

    /* Create semaphore for SPI callback */
    SemaphoreP_Params_init(&semParams);
    semParams.mode    = SemaphoreP_Mode_BINARY;
    callbackSemHandle = SemaphoreP_create(0, &semParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(callbackSemHandle, "Failed to allocate callbackSemHandle");

    /* Enable RETURN_PARTIAL */
    controlStatus = SPI_control(spiHandle, DEV_SPECIFIC_CMD_RETURN_PARTIAL_ENABLE, NULL);
    TEST_ASSERT_EQUAL_INT_MESSAGE(SPI_STATUS_SUCCESS, controlStatus, "Failed to enable return partial.");

    setupBuffers(in_numFrames, 8);

    setupSpiTransaction(&spiQueuedTransfer1, in_numFrames, &txBuf[0], &rxBuf[0], NULL);
    setupSpiTransaction(&spiQueuedTransfer2, in_numFrames, &txBuf[in_transCount1], &rxBuf[in_transCount1], NULL);

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiQueuedTransfer1);
    TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer 1");

    /* Initiate a second SPI transfer which will be queued */
    transferStatus = SPI_transfer(spiHandle, &spiQueuedTransfer2);
    TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer 2");

    /* Wait for the callback to execute signaling that the transaction is over.*/
    SemaphoreP_pend(callbackSemHandle, SemaphoreP_WAIT_FOREVER);

    /* Check that all transfer calls were successful. */
    TEST_ASSERT_EQUAL_UINT_MESSAGE(2, callbackCounter, "Not all transfer calls succeeded");

    /* Disable RETURN_PARTIAL */
    controlStatus = SPI_control(spiHandle, DEV_SPECIFIC_CMD_RETURN_PARTIAL_DISABLE, NULL);
    TEST_ASSERT_EQUAL_INT_MESSAGE(SPI_STATUS_SUCCESS, controlStatus, "Failed to disable return partial.");

    *out_txBufferAddr = (uint32_t)txBuf;
    *out_rxBufferAddr = (uint32_t)rxBuf;

    spiCleanup();
}

/*
 *  ======== test_queuedTransfers ========
 */
void test_queuedTransfers(uint32_t in_numFrames,
                          uint32_t in_bitRate,
                          uint32_t in_transCount1,
                          uint32_t in_transCount2,
                          uint32_t in_dutRole,
                          uint32_t *out_txBufferAddr,
                          uint32_t *out_rxBufferAddr)
{
    /* We'll use a specific set of SPI transactions for this test */
    SPI_Transaction spiQueuedTransfer1;
    SPI_Transaction spiQueuedTransfer2;
    int16_t status = SPI_STATUS_SUCCESS;
    int16_t controlStatus;

    SPI_init();
    SPI_Params_init(&spiParams);
    spiParams.dataSize            = 8;
    spiParams.frameFormat         = SPI_POL0_PHA0;
    spiParams.bitRate             = in_bitRate;
    spiParams.transferMode        = SPI_MODE_CALLBACK;
    spiParams.mode                = (SPI_Mode)in_dutRole;
    spiParams.transferCallbackFxn = transferQueuedCallback;

    setupBuffers(in_numFrames, 8);

    /* Initialize and open, check for valid handle */
    spiHandle = NULL;
    spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(spiHandle, "SPI driver failed to open.");

    /* Create semaphore for SPI callback */
    SemaphoreP_Params_init(&semParams);
    semParams.mode    = SemaphoreP_Mode_BINARY;
    callbackSemHandle = SemaphoreP_create(0, &semParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(callbackSemHandle, "Failed to allocate callbackSemHandle");

    /* Enable manual start mode */
    controlStatus = SPI_control(spiHandle, DEV_SPECIFIC_CMD_SET_MANUAL, NULL);
    TEST_ASSERT_EQUAL_INT_MESSAGE(SPI_STATUS_SUCCESS, controlStatus, "Failed to set manual mode.");

    setupSpiTransaction(&spiQueuedTransfer1, in_transCount1, &txData.txData8[0], &rxData.rxData8[0], NULL);

    setupSpiTransaction(&spiQueuedTransfer2,
                        in_transCount2,
                        &txData.txData8[in_transCount1],
                        &rxData.rxData8[in_transCount1],
                        NULL);

    if (!SPI_transfer(spiHandle, &spiQueuedTransfer1))
    {
        status = SPI_STATUS_ERROR;
    }

    if (!SPI_transfer(spiHandle, &spiQueuedTransfer2))
    {
        status = SPI_STATUS_ERROR;
    }

    TEST_ASSERT_EQUAL_INT_MESSAGE(status, SPI_STATUS_SUCCESS, "Failed to queue transactions.");

    /* Enable the SPI transfers */
    if (status == SPI_STATUS_SUCCESS)
    {
        SPI_control(spiHandle, DEV_SPECIFIC_CMD_MANUAL_START, NULL);
        TEST_ASSERT_EQUAL_INT_MESSAGE(SPI_STATUS_SUCCESS, controlStatus, "Failed to start in manual mode.");
    }
    else
    {
        status = SPI_STATUS_ERROR;
    }

    /* Wait for the callback to execute signaling that the transaction is over. */
    SemaphoreP_pend(callbackSemHandle, SemaphoreP_WAIT_FOREVER);

    /* Check that all transfer calls were successful. */
    TEST_ASSERT_EQUAL_UINT_MESSAGE(2, callbackCounter, "Not all transfer calls succeeded");

    /* Disable manual start mode */
    SPI_control(spiHandle, DEV_SPECIFIC_CMD_CLR_MANUAL, NULL);

    *out_rxBufferAddr = (uint32_t)rxBuf;
    *out_txBufferAddr = (uint32_t)txBuf;

    spiCleanup();
}
