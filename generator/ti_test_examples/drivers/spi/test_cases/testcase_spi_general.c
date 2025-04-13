/*
 * Copyright (c) 2021-2025, Texas Instruments Incorporated
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
#include <unistd.h>
#include "testcase_spi_common.h"
#include "ti_drivers_config.h"

/*******************************************************************************
 * API tests
 */

/*
 *  ======== test_openTwice ========
 */
void test_openTwice(void)
{
    SPI_init();
    SPI_Handle spiHandle1 = NULL;
    SPI_Params_init(&spiParams);

    /* Attempt to open twice, should fail the second time */
    spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NOT_NULL(spiHandle);

    spiHandle1 = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NULL(spiHandle1);

    spiCleanup();
}

/*
 *  ======== test_openDefaultParams ========
 */
void test_openDefaultParams(void)
{
    SPI_Params *spiParamsEmpty = NULL;
    uint32_t index;

    SPI_init();

    /* Attempt to open all valid indexes */
    for (index = 0; index < CONFIG_TI_DRIVERS_SPI_COUNT; index++)
    {
        spiHandle = SPI_open(index, spiParamsEmpty);
        TEST_ASSERT_NOT_NULL(spiHandle);
        SPI_close(spiHandle);
        spiHandle = NULL;
    }

    /* Attempt to open an invalid index (greater than SPI_count). Should return NULL */
    spiHandle = SPI_open(CONFIG_TI_DRIVERS_SPI_COUNT, spiParamsEmpty);
    TEST_ASSERT_NULL(spiHandle);

    spiCleanup();
}

/*
 *  ======== test_transferTransactionCountZero ========
 */
void test_transferTransactionCountZero(void)
{
    uint32_t customArg = DUMMY_TRANSACTION_ID;

    /* Initialize peripheral SPI transaction structure */
    setupSpiTransaction(&spiTransaction, 0, txBuf, rxBuf, &customArg);

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiTransaction);
    TEST_ASSERT_FALSE_MESSAGE(transferStatus, "The SPI transfer did not fail as it should have.");

    spiCleanup();
}

/*
 *  ======== test_basicTransfer ========
 */
void test_basicTransfer(uint32_t in_numFrames,
                        uint32_t in_timeoutExpected,
                        uint32_t *out_txBufferAddr,
                        uint32_t *out_rxBufferAddr)
{
    uint32_t customArg = DUMMY_TRANSACTION_ID;

    setupSpiTransaction(&spiTransaction, in_numFrames, txBuf, rxBuf, &customArg);

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiTransaction);

    if (spiParams.transferMode == SPI_MODE_CALLBACK)
    {
        /* Wait for the callback to execute signaling that the transaction is over. */
        SemaphoreP_pend(callbackSemHandle, SemaphoreP_WAIT_FOREVER);

        TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_COMPLETED,
                                       (uint8_t)spiTransaction.status,
                                       "Status code is not SPI_TRANSFER_COMPLETED");
        TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer");
    }
    else if (spiParams.transferMode == SPI_MODE_BLOCKING)
    {
        if (((bool)in_timeoutExpected) && (spiParams.mode == SPI_PERIPHERAL))
        {
            /* Check that the transfer call failed. */
            TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_FAILED,
                                           (uint8_t)spiTransaction.status,
                                           "Wrong transaction status code");
            TEST_ASSERT_FALSE_MESSAGE(transferStatus, "The SPI transfer should have failed but it was successful");
        }
        else
        {
            TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_COMPLETED,
                                           (uint8_t)spiTransaction.status,
                                           "Status code is not SPI_TRANSFER_COMPLETED");
            TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer");
        }
    }

    *out_rxBufferAddr = (uint32_t)rxBuf;
    *out_txBufferAddr = (uint32_t)txBuf;

    spiCleanup();
}

/*
 *  ======== test_pollingTransfer ========
 */
void test_pollingTransfer(uint32_t in_numFrames, uint32_t *out_txBufferAddr, uint32_t *out_rxBufferAddr)
{
    SPI_Transaction spiPollingTransaction;
    static uint8_t txDataPolling[UDMA_LIMIT];
    static uint8_t rxDataPolling[UDMA_LIMIT];
    uint32_t i;

    /* Set data buffers */
    for (i = 0; i < in_numFrames; i++)
    {
        txDataPolling[i] = (in_numFrames - 1 - i);
        rxDataPolling[i] = 0;
    }

    setupSpiTransaction(&spiPollingTransaction, in_numFrames, txDataPolling, rxDataPolling, NULL);

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiPollingTransaction);

    TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_COMPLETED,
                                   (uint8_t)spiTransaction.status,
                                   "Status code is not SPI_TRANSFER_COMPLETED");
    TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer");

    *out_rxBufferAddr = (uint32_t)rxDataPolling;
    *out_txBufferAddr = (uint32_t)txDataPolling;

    /* Clean up */
    if (spiHandle != NULL)
    {
        SPI_close(spiHandle);
        spiHandle = NULL;
    }

    transferStatus = (bool)false;

    /* Clear structures to prevent lingering settings between tests */
    memset(&spiParams, 0x00, sizeof(spiParams));
    memset(&spiPollingTransaction, 0x00, sizeof(spiPollingTransaction));
}

/*
 *  ======== test_callbackTransferCancel ========
 */
void test_callbackTransferCancel(uint32_t in_numFrames,
                                 uint32_t in_frameSize,
                                 uint32_t in_clockRate,
                                 uint32_t *out_txBufferAddr,
                                 uint32_t *out_rxBufferAddr,
                                 uint32_t *out_count)
{
    uint32_t sysTickPeriod;
    uint32_t transferTimeMicroSeconds;
    uint32_t timeoutSysTicks;
    uint32_t customArg = DUMMY_TRANSACTION_ID;

    setupSpiTransaction(&spiTransaction, in_numFrames, txBuf, rxBuf, &customArg);

    /*
     * Derive a timeout from the input arguments to determine the best moment
     * during the transfer to cancel it. Ideally we want to cancel it only
     * after we have sent some data.
     */
    sysTickPeriod            = ClockP_getSystemTickPeriod();
    transferTimeMicroSeconds = ((1000000 * in_frameSize * in_numFrames) / in_clockRate) / 4;
    timeoutSysTicks          = transferTimeMicroSeconds / sysTickPeriod;

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiTransaction);
    TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_STARTED, (uint8_t)spiTransaction.status, "The transfer didn't start");

    /*
     * Try to obtain the callback semaphore using the previously defined
     * timeout. If we can't, cancel the transfer. Given how the timeout was
     * calculated, we can be sure that the transfer will be canceled and that
     * at some of the data will be transmitted.
     */
    if (SemaphoreP_pend(callbackSemHandle, timeoutSysTicks) != SemaphoreP_OK)
    {
        /* Cancel the transfer, verify transfer.status & amount sent.*/
        SPI_transferCancel(spiHandle);
    }

    /* Wait for the callback to execute signaling that the transaction is over.*/
    SemaphoreP_pend(callbackSemHandle, SemaphoreP_WAIT_FOREVER);

    /* Check transaction status code set by the SPI driver */
    TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_CANCELED,
                                   (uint8_t)spiTransaction.status,
                                   "The transfer wasn't canceled");

    /* Check that at least some data was sent before the transfer cancel */
    TEST_ASSERT_GREATER_THAN_MESSAGE(0,
                                     (uint8_t)spiTransaction.count,
                                     "No data was sent before the transfer was canceled");

    /* Return the data received by the DUT */
    *out_count        = (uint32_t)&spiTransaction.count;
    *out_rxBufferAddr = (uint32_t)rxBuf;
    *out_txBufferAddr = (uint32_t)txBuf;

    spiCleanup();
}

/*
 *  ======== test_cancelNonExistentTransfer ========
 */
void test_cancelNonExistentTransfer(uint32_t in_numFrames, uint32_t *out_txBufferAddr, uint32_t *out_rxBufferAddr)
{
    uint32_t customArg = DUMMY_TRANSACTION_ID;

    setupSpiTransaction(&spiTransaction, in_numFrames, txBuf, rxBuf, &customArg);

    /* Cancel a transfer that hasn't been started. The status of the transaction should not be affected. */
    SPI_transferCancel(spiHandle);
    TEST_ASSERT_EQUAL_MESSAGE(SPI_TRANSFER_COMPLETED, spiTransaction.status, "The transaction status is not correct");

    /* Immediately start a transfer */
    transferStatus = SPI_transfer(spiHandle, &spiTransaction);

    /* Wait for the callback to execute signaling that the transaction is over. */
    SemaphoreP_pend(callbackSemHandle, SemaphoreP_WAIT_FOREVER);

    TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_COMPLETED,
                                   (uint8_t)spiTransaction.status,
                                   "Status code is not SPI_TRANSFER_COMPLETED");
    TEST_ASSERT_TRUE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer");

    *out_rxBufferAddr = (uint32_t)rxBuf;
    *out_txBufferAddr = (uint32_t)txBuf;

    spiCleanup();
}

/*
 *  ======== test_transferTimeoutAsController ========
 */
void test_transferTimeoutAsController(uint32_t in_numFrames,
                                      uint32_t in_clockRate,
                                      uint32_t in_frameSize,
                                      uint32_t in_frameFormat,
                                      uint32_t *out_txBufferAddr,
                                      uint32_t *out_rxBufferAddr,
                                      uint32_t *out_countAddr)
{
    uint32_t sysTickPeriod;
    uint32_t transferTimeMicroSeconds;
    uint32_t timeoutSysTicks;

    /*
     * Derive a timeout from the input arguments to determine the best moment
     * during the transfer to cancel it. Ideally we want to cancel it only
     * after we have sent some data.
     */
    sysTickPeriod            = ClockP_getSystemTickPeriod();
    transferTimeMicroSeconds = ((1000000 * in_frameSize * in_numFrames) / in_clockRate) / 2;
    timeoutSysTicks          = transferTimeMicroSeconds / sysTickPeriod;

    SPI_init();
    SPI_Params_init(&spiParams);
    spiParams.dataSize        = in_frameSize;
    spiParams.frameFormat     = (SPI_FrameFormat)SPI_POL0_PHA0;
    spiParams.bitRate         = in_clockRate;
    spiParams.transferMode    = SPI_MODE_BLOCKING;
    spiParams.transferTimeout = timeoutSysTicks;
    spiParams.mode            = SPI_CONTROLLER;

    setupBuffers(in_numFrames, in_frameSize);

    /* Initialize and open, check for valid handle */
    spiHandle = NULL;
    spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(spiHandle, "SPI driver failed to open.");

    setupSpiTransaction(&spiTransaction, in_numFrames, txBuf, rxBuf, NULL);

    /* Initiate SPI transfer */
    transferStatus = SPI_transfer(spiHandle, &spiTransaction);

    TEST_ASSERT_EQUAL_UINT_MESSAGE(SPI_TRANSFER_FAILED,
                                   (uint8_t)spiTransaction.status,
                                   "Status code is not SPI_TRANSFER_FAILED");
    TEST_ASSERT_FALSE_MESSAGE(transferStatus, "Unsuccessful peripheral SPI transfer");

    *out_countAddr    = (uint32_t)&spiTransaction.count;
    *out_rxBufferAddr = (uint32_t)rxBuf;
    *out_txBufferAddr = (uint32_t)txBuf;

    spiCleanup();
}

/*
 *  ======== test_multipleOpenClose ========
 */
void test_multipleOpenClose(uint16_t in_count)
{
    SPI_init();
    SPI_Params_init(&spiParams);
    uint16_t i = 0;

    while (i < in_count)
    {
        i++;
        /* Attempt to open and close multiple times, should not fail */
        spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
        TEST_ASSERT_NOT_NULL(spiHandle);
        SPI_close(spiHandle);
    }
}