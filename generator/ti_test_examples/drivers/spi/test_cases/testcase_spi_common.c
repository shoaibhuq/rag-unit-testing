/*
 * Copyright (c) 2021-2022, Texas Instruments Incorporated
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

#include "testcase_spi_common.h"
#include "ti_drivers_config.h"

SPI_Handle spiHandle = NULL;
SPI_Params spiParams;

SemaphoreP_Params semParams;
SemaphoreP_Handle callbackSemHandle = NULL;
SemaphoreP_Handle syncSemHandle     = NULL;

SPI_Transaction spiTransaction;

/* Tx and Rx buffers for regular transfers. SPI data frames can be any size from 4-bits to 16-bits. */
SPI_TxData txData;
SPI_RxData rxData;
uint8_t *txBuf;
uint8_t *rxBuf;

bool callbackStatus     = (bool)false;
bool transferStatus     = (bool)false;
uint8_t callbackCounter = 0;

/*******************************************************************************
 * Callback Functions
 */

/* Callback for regular transfers tests */
void transferCallback(SPI_Handle handle, SPI_Transaction *transaction)
{
    uint8_t *transactionArgPtr = (uint8_t *)(transaction->arg);

    /* Verify that the transfer completed and that the arg parameter was successfully passed. */
    if ((transaction->status == SPI_TRANSFER_COMPLETED) && (*transactionArgPtr == DUMMY_TRANSACTION_ID))
    {
        callbackStatus = (bool)true;
    }
    else
    {
        callbackStatus = (bool)false;
    }
    SemaphoreP_post(callbackSemHandle);
}

/* Callback for queued transfers tests */
void transferQueuedCallback(SPI_Handle handle, SPI_Transaction *transaction)
{
    /* Increase a counter and only post semaphore once both transfers succeeded*/
    if (transaction->status == SPI_TRANSFER_COMPLETED)
    {
        callbackCounter++;
    }

    if (callbackCounter == 2)
    {
        SemaphoreP_post(callbackSemHandle);
    }
}

/* Callback for partial queued transfers tests */
void transferPartialQueuedCallback(SPI_Handle handle, SPI_Transaction *transaction)
{
    /* Increase a counter and only post semaphore once both transfers succeeded*/
    if (transaction->status == SPI_TRANSFER_CSN_DEASSERT)
    {
        callbackCounter++;
    }

    if (callbackCounter == 2)
    {
        SemaphoreP_post(callbackSemHandle);
    }
}

/*******************************************************************************
 * Helper Functions
 */

/*
 *  ======== spiCleanup ========
 */
void spiCleanup(void)
{
    if (spiHandle != NULL)
    {
        SPI_close(spiHandle);
        spiHandle = NULL;
    }

    if (callbackSemHandle != NULL)
    {
        SemaphoreP_delete(callbackSemHandle);
        callbackSemHandle = NULL;
    }

    transferStatus  = (bool)false;
    callbackCounter = 0;

    /* Clear structures to prevent lingering settings between tests */
    memset(&spiParams, 0x00, sizeof(spiParams));
    memset(&spiTransaction, 0x00, sizeof(spiTransaction));
}

/*
 *  ======== setupSpiTransaction ========
 */
void setupSpiTransaction(SPI_Transaction *pTransaction, size_t count, void *txBuf, void *rxBuf, void *customArg)
{
    pTransaction->count = count;
    pTransaction->txBuf = txBuf;
    pTransaction->rxBuf = rxBuf;
    pTransaction->arg   = customArg;
}

/*
 *  ======== setupBuffers ========
 */
void setupBuffers(uint32_t numFrames, uint32_t frameSize)
{
    uint32_t i;

    /* Clear buffers */
    for (i = 0; i < numFrames; i++)
    {
        if (frameSize <= 8)
        {
            txData.txData8[i] = 0;
            rxData.rxData8[i] = 0;
        }
        else
        {
            txData.txData16[i] = 0;
            rxData.rxData16[i] = 0;
        }
    }

    /*
     * Fill Tx data buffer with a decreasing sequence while considering the
     * maximum number that can be sent with each frame size (i.e. from 4 to 16
     * bits).
     */
    for (i = 0; i < numFrames; i++)
    {
        if (frameSize <= 8)
        {
            txData.txData8[i] = (uint8_t)(numFrames - 1 - i) % (1 << frameSize);
        }
        else
        {
            txData.txData16[i] = (uint16_t)(numFrames - 1 - i) % (1 << frameSize);
        }
    }

    /* Set buffer pointers */
    if (frameSize <= 8)
    {
        txBuf = txData.txData8;
        rxBuf = rxData.rxData8;
    }
    else
    {
        txBuf = (uint8_t *)txData.txData16;
        rxBuf = (uint8_t *)rxData.rxData16;
    }
}

/*******************************************************************************
 * Common Test Functions
 */

/*
 *  ======== test_spiConfigure ========
 */
void test_spiConfigure(uint32_t in_dutRole,
                       uint32_t in_clockRate,
                       uint32_t in_frameSize,
                       uint32_t in_frameFormat,
                       uint32_t in_transferMode,
                       uint32_t in_timeout,
                       uint32_t in_numFrames)
{
    SPI_init();
    SPI_Params_init(&spiParams);
    spiParams.dataSize            = in_frameSize;
    spiParams.frameFormat         = (SPI_FrameFormat)in_frameFormat;
    spiParams.bitRate             = in_clockRate;
    spiParams.transferMode        = (SPI_TransferMode)in_transferMode;
    spiParams.transferTimeout     = in_timeout;
    spiParams.mode                = (SPI_Mode)in_dutRole;
    spiParams.transferCallbackFxn = transferCallback;

    setupBuffers(in_numFrames, in_frameSize);

    /* Initialize and open, check for valid handle */
    spiHandle = NULL;
    spiHandle = SPI_open(CONFIG_SPI_0, &spiParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(spiHandle, "SPI driver failed to open.");

    /* Create semaphore for SPI callback */
    SemaphoreP_Params_init(&semParams);
    semParams.mode    = SemaphoreP_Mode_BINARY;
    callbackSemHandle = SemaphoreP_create(0, &semParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(callbackSemHandle, "Failed to allocate callbackSemHandle");
}
