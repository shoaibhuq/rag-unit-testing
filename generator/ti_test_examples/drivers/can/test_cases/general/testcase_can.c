/*
 * Copyright (c) 2023-2025, Texas Instruments Incorporated
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

#include <ti/drivers/CAN.h>
#include <ti/drivers/can/TCAN455X.h>

#include <ti/drivers/dpl/ClockP.h>
#include <ti/drivers/dpl/SemaphoreP.h>

#include <ti/devices/DeviceFamily.h>

#include <test_protocol/test_protocol.h>
#include <unity/unity.h>

#include "ti_drivers_config.h"

/* Standard ID - 11 bits */
#define TEST_STD_ID1 0x5AA
#define TEST_STD_ID2 0x5AB
#define TEST_STD_ID3 0x5AC

/* Extended ID - 29 bits */
#define TEST_EXT_ID1 0x12345678U
#define TEST_EXT_ID2 0x12345679U
#define TEST_EXT_ID3 0x12345680U

#define DLC_TABLE_SIZE 16U

#define CAN_EVENT_MASK                                                                             \
    (CAN_EVENT_RX_DATA_AVAIL | CAN_EVENT_TX_FINISHED | CAN_EVENT_BUS_OFF | CAN_EVENT_ERR_PASSIVE | \
     CAN_EVENT_RX_FIFO_MSG_LOST | CAN_EVENT_RX_RING_BUFFER_FULL | CAN_EVENT_BIT_ERR_UNCORRECTED |  \
     CAN_EVENT_SPI_XFER_ERROR | CAN_EVENT_TX_EVENT_AVAIL | CAN_EVENT_TX_EVENT_LOST)

/* Rx and Tx buffer elements */
CAN_RxBufElement rxElem;
CAN_TxBufElement txElem;

CAN_TxEventElement txEventElem;

/* Rx message semaphore handle */
SemaphoreP_Handle rxSemHandle;

/* Tx event semaphore handle */
SemaphoreP_Handle txEventSemHandle;

/* CAN handle */
CAN_Handle canHandle;

/* Counter tracking number of times the event callback occurs with an Rx data available event */
volatile uint32_t rxEventCnt;
/* Counter tracking number of times the event callback occurs with an Tx finished event */
volatile uint32_t txEventCnt;
/* Counter tracking number of times the event callback occurs with an Tx Event FIFO event */
volatile uint32_t txEventAvailCnt;
/* Counter tracking the Tx Event FIFO fill level associated with an Tx Event FIFO event */
volatile uint32_t txEventFifoFillCnt;
/* Counter tracking number of times the event callback occurs with an Tx Event lost event */
volatile uint32_t txEventFifoLostCnt;
/* Counter tracking number of times the event callback occurs with an Rx buffer full event */
volatile uint32_t rxBufFullCnt;
/* Counter tracking number of times the event callback occurs with an error event */
volatile uint32_t errEventCnt;

/* Last event */
volatile uint32_t lastEvent;

/* Last error event */
volatile uint32_t lastErrEvent;

/* Last arg provided to event callback */
volatile void *lastCallbackArg;

/* Payload bytes indexed by Data Length Code (DLC) field. */
const uint32_t dlcToDataSize[DLC_TABLE_SIZE] = {0U, 1U, 2U, 3U, 4U, 5U, 6U, 7U, 8U, 12U, 16U, 20U, 24U, 32U, 48U, 64U};

#define STD_MSG_FILTER_NUM 1U
#define EXT_MSG_FILTER_NUM 1U

MCAN_StdMsgIDFilterElement stdMsgIDFilter[STD_MSG_FILTER_NUM] = {
    {.sfid1 = TEST_STD_ID1, .sfid2 = TEST_STD_ID2, .sfec = CAN_FEC_REJECT_ID, .sft = CAN_FILTER_RANGE},
};

MCAN_ExtMsgIDFilterElement extMsgIDFilter[EXT_MSG_FILTER_NUM] = {
    {.efid1 = TEST_EXT_ID1, .efid2 = TEST_EXT_ID2, .efec = CAN_FEC_REJECT_ID, .eft = CAN_FILTER_DUAL_ID},
};

/* Message RAM configuration with size <= 2KB (for compatibility with TCAN455x)
 *  - Each standard filter element occupies 4-bytes.
 *  - Each extended filter element occupies 8-bytes.
 *  - Each Rx/Tx buffer occupies 72-bytes when CAN FD is enabled or 16-bytes
 *    for classic CAN.
 *  - Each Tx Event occupies 8-bytes.
 */
const CAN_MsgRamConfig msgRamConfig = {
    .stdFilterNum       = STD_MSG_FILTER_NUM,
    .extFilterNum       = EXT_MSG_FILTER_NUM,
    .stdMsgIDFilterList = &stdMsgIDFilter[0],
    .extMsgIDFilterList = &extMsgIDFilter[0],

    .rxFifoNum[0]   = 8U,
    .rxFifoNum[1]   = 2U,
    .rxBufNum       = 1U,
    .txBufNum       = 1U,
    .txFifoQNum     = DLC_TABLE_SIZE - 1U, /* Total number of DLCs - txRingBufferSize */
    .txFifoQMode    = 0U,
    .txEventFifoNum = 4U,
};

const CAN_DataBitRateTimingRaw rawDataBitRateTiming = {
    /* 1Mbps with 40MHz clk and 80% sample point ((40E6 / 2) / (15 + 4 + 1) = 1E6) */
    .dbrp            = 1U,
    .dtSeg1          = 14U,
    .dtSeg2          = 3U,
    .dsjw            = 3U,
    .tdcOffset       = 1U,
    .tdcFilterWinLen = 2U,
};

const CAN_BitRateTimingRaw rawBitTiming = {
    /* 500kbps nominal with 40MHz clk and 87.5% sample point ((40E6 / 1) / (69 + 10 + 1) = 500E3) */
    .nbrp       = 0U,
    .ntSeg1     = 69U,
    .ntSeg2     = 9U,
    .nsjw       = 9U,
    .dataTiming = &rawDataBitRateTiming,
};

extern const CAN_Config CAN_config[];

void eventCallback(CAN_Handle handle, uint32_t event, uint32_t data, void *userArg)
{
    if (event == CAN_EVENT_RX_DATA_AVAIL)
    {
        rxEventCnt++;
        SemaphoreP_post(rxSemHandle);
    }
    else if (event == CAN_EVENT_TX_FINISHED)
    {
        txEventCnt++;
    }
    else if (event == CAN_EVENT_RX_RING_BUFFER_FULL)
    {
        rxBufFullCnt++;
        SemaphoreP_post(rxSemHandle);
    }
    else if (event == CAN_EVENT_TX_EVENT_AVAIL)
    {
        txEventAvailCnt++;
        txEventFifoFillCnt += data;
        SemaphoreP_post(txEventSemHandle);
    }
    else if (event == CAN_EVENT_TX_EVENT_LOST)
    {
        txEventFifoLostCnt++;
    }
    else
    {
        lastErrEvent = event;
        errEventCnt++;
    }

    lastEvent       = event;
    lastCallbackArg = userArg;
}

void initTest(void)
{
    SemaphoreP_Params semParams;

    SemaphoreP_Params_init(&semParams);
    semParams.mode = SemaphoreP_Mode_BINARY;
    rxSemHandle    = SemaphoreP_create(0, &(semParams));
    TEST_ASSERT_NOT_NULL_MESSAGE(rxSemHandle, "rxSemHandle was NULL");

    txEventSemHandle = SemaphoreP_create(0, &(semParams));
    TEST_ASSERT_NOT_NULL_MESSAGE(txEventSemHandle, "txEventSemHandle was NULL");

    rxEventCnt         = 0U;
    txEventCnt         = 0U;
    txEventFifoLostCnt = 0U;
    txEventAvailCnt    = 0U;
    rxBufFullCnt       = 0U;
    errEventCnt        = 0U;
    lastEvent          = 0U;
    lastErrEvent       = 0U;
    lastCallbackArg    = NULL;
}

void cleanupTest(void)
{
    CAN_close(canHandle);

    if (rxSemHandle != NULL)
    {
        SemaphoreP_delete(rxSemHandle);
    }

#if (DeviceFamily_PARENT != DeviceFamily_PARENT_CC27XX)
    TCAN455X_disableSleepWakeErrorTimeout();
#endif
}

void txMessageSetup(uint32_t id, uint32_t extID, uint32_t dlc, uint32_t fdFormat, uint32_t brsEnable)
{
    uint_fast8_t i;

    txElem.id  = id;
    txElem.rtr = 0U;
    txElem.xtd = extID;
    txElem.esi = 0U;
    txElem.brs = brsEnable;
    txElem.dlc = dlc;
    txElem.fdf = fdFormat;
    txElem.efc = 0U;
    txElem.mm  = 252U;

    memset(txElem.data, 0xEE, sizeof(txElem.data));
    for (i = 0U; i < dlcToDataSize[txElem.dlc]; i++)
    {
        txElem.data[i] = i;
    }
}

void txMessage(uint32_t id, uint32_t extID, uint32_t dlc, uint32_t fdFormat, uint32_t brsEnable)
{
    int_fast16_t result;

    txMessageSetup(id, extID, dlc, fdFormat, brsEnable);

    result = CAN_write(canHandle, &txElem);
    TEST_ASSERT_EQUAL_INT(CAN_STATUS_SUCCESS, result);
}

void txMessageWithEvent(uint32_t id, uint32_t extID, uint32_t dlc, uint32_t fdFormat, uint32_t brsEnable)
{
    int_fast16_t result;

    txMessageSetup(id, extID, dlc, fdFormat, brsEnable);
    /* Set Event FIFO Control (EFC) bit to enable Tx Event storage */
    txElem.efc = 1U;

    result = CAN_write(canHandle, &txElem);
    TEST_ASSERT_EQUAL_INT(CAN_STATUS_SUCCESS, result);
}

void txMessageBuf(uint32_t bufIdx, uint32_t id, uint32_t extID, uint32_t dlc, uint32_t fdFormat, uint32_t brsEnable)
{
    int_fast16_t result;

    txMessageSetup(id, extID, dlc, fdFormat, brsEnable);

    result = CAN_writeBuffer(canHandle, bufIdx, &txElem);
    TEST_ASSERT_EQUAL_INT(CAN_STATUS_SUCCESS, result);
}

void rxMessage(void)
{
    int_fast16_t result;

    result = CAN_read(canHandle, &rxElem);
    TEST_ASSERT_EQUAL_INT(CAN_STATUS_SUCCESS, result);

    TEST_ASSERT_EQUAL_INT(txElem.id, rxElem.id);
    TEST_ASSERT_EQUAL_INT(txElem.fdf, rxElem.fdf);
    TEST_ASSERT_EQUAL_INT(txElem.dlc, rxElem.dlc);
    TEST_ASSERT_EQUAL_INT(0, rxElem.esi);  /* Assert no error state */
    TEST_ASSERT_EQUAL_INT(0, rxElem.rtr);  /* Assert a data frame was Rx'd */
    TEST_ASSERT_NOT_EQUAL(0, rxElem.rxts); /* Assert non-zero timestamp */

    if (txElem.dlc != 0U)
    {
        TEST_ASSERT_EQUAL_UINT8_ARRAY(txElem.data, rxElem.data, dlcToDataSize[txElem.dlc]);
    }

    TEST_ASSERT_EQUAL_INT(0, errEventCnt);

#if (DeviceFamily_PARENT != DeviceFamily_PARENT_CC27XX)
    /* Check the device status and mask off bit 3 (Internal_access_active) */
    uint32_t status = TCAN455X_getStatus() & ~(0x8);
    TEST_ASSERT_EQUAL_INT(0, status);
#endif
}

void readTxEvent(uint32_t expectedDlc)
{
    int_fast16_t result;

    result = CAN_readTxEvent(canHandle, &txEventElem);
    TEST_ASSERT_EQUAL_INT(CAN_STATUS_SUCCESS, result);

    TEST_ASSERT_EQUAL_INT(txElem.id, txEventElem.id);
    TEST_ASSERT_EQUAL_INT(txElem.mm, txEventElem.mm);
    TEST_ASSERT_EQUAL_INT(txElem.fdf, txEventElem.fdf);
    TEST_ASSERT_EQUAL_INT(expectedDlc, txEventElem.dlc);
    TEST_ASSERT_EQUAL_INT(1, txEventElem.et);   /* Assert Event Type is Tx (1) */
    TEST_ASSERT_EQUAL_INT(0, rxElem.esi);       /* Assert no error state */
    TEST_ASSERT_EQUAL_INT(0, rxElem.rtr);       /* Assert a data frame was Rx'd */
    TEST_ASSERT_NOT_EQUAL(0, txEventElem.txts); /* Assert non-zero timestamp */

    TEST_ASSERT_EQUAL_INT(0, errEventCnt);
}

/*
 * Tests Tx for every valid data length by using loopback mode and comparing the
 * received message. Tx Queue is used. Also tests that the user-supplied
 * callback argument is correctly supplied when the event callback is called.
 */
void test_canTx(uint32_t in_extID, uint32_t in_canFD, uint32_t in_brs)
{
    CAN_Params canParams;
    uint_fast8_t dlc;
    uint_fast8_t dlcLimit;
    uint32_t callbackArg;
    uint32_t id;

    initTest();

    /* Init CAN without any msg filters and bit rate set via SysConfig */
    CAN_Params_init(&canParams);
    canParams.eventCbk  = eventCallback;
    canParams.eventMask = CAN_EVENT_MASK;
    canParams.userArg   = &callbackArg;
    canHandle           = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    if (in_canFD == 1U)
    {
        dlcLimit = CAN_DLC_64B;
    }
    else
    {
        dlcLimit = CAN_DLC_8B;
    }

    if (in_extID == 1U)
    {
        id = TEST_EXT_ID1;
    }
    else
    {
        id = TEST_STD_ID1;
    }

    for (dlc = 0U; dlc <= dlcLimit; dlc++)
    {
        TestProtocol_writeTestContext(dlc);

        txMessage(id, in_extID, dlc, in_canFD, in_brs);
        SemaphoreP_pend(rxSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
        rxMessage();

        TEST_ASSERT_EQUAL_INT(1, rxEventCnt);
        TEST_ASSERT_EQUAL_INT(1, txEventCnt);
        rxEventCnt = 0U;
        txEventCnt = 0U;

        TEST_ASSERT_EQUAL_PTR(&callbackArg, lastCallbackArg);
        lastCallbackArg = NULL;

        /* Increment the ID */
        id++;
    }

    cleanupTest();
}

/*
 * Tests Tx for every valid data length by using loopback mode and comparing the
 * received message. Dedicated Tx buffer is used.
 */
void test_canTxBuf(uint32_t in_extID, uint32_t in_canFD, uint32_t in_brs)
{
    CAN_Params canParams;
    uint_fast8_t dlc;
    uint_fast8_t dlcLimit;
    uint32_t id;

    initTest();

    /* Init CAN with a dedicated Tx Buf and msg filters */
    CAN_Params_init(&canParams);
    canParams.msgRamConfig = &msgRamConfig;
    canParams.eventCbk     = eventCallback;
    canParams.eventMask    = CAN_EVENT_MASK;
    canHandle              = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    if (in_canFD == 1U)
    {
        dlcLimit = CAN_DLC_64B;
    }
    else
    {
        dlcLimit = CAN_DLC_8B;
    }

    /* Use a msg ID which is not filtered out */
    if (in_extID == 1U)
    {
        id = TEST_EXT_ID3;
    }
    else
    {
        id = TEST_STD_ID3;
    }

    for (dlc = 0U; dlc <= dlcLimit; dlc++)
    {
        TestProtocol_writeTestContext(dlc);
        /* Transmit using dedicated Tx Buf 0 */
        txMessageBuf(0U, id, in_extID, dlc, in_canFD, in_brs);
        SemaphoreP_pend(rxSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
        rxMessage();

        TEST_ASSERT_EQUAL_INT(1, rxEventCnt);
        TEST_ASSERT_EQUAL_INT(1, txEventCnt);
        rxEventCnt = 0U;
        txEventCnt = 0U;

        /* Increment the ID */
        id++;
    }

    cleanupTest();
}

/*
 * Tests Tx Event FIFO set by using loopback mode and comparing the received
 * message and Tx Event with the transmitted msg. Tx Queue is used.
 */
void test_canTxEventFifo(void)
{
    CAN_Params canParams;
    uint_fast8_t dlc;

    initTest();

    /* Init CAN without any msg filters and bit rate set via SysConfig */
    CAN_Params_init(&canParams);
    canParams.eventCbk  = eventCallback;
    canParams.eventMask = CAN_EVENT_MASK;
    canHandle           = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    for (dlc = 0U; dlc <= CAN_DLC_64B; dlc++)
    {
        TestProtocol_writeTestContext(dlc);

        txMessageWithEvent(TEST_EXT_ID3, 1U, dlc, 1U, 1U);

        SemaphoreP_pend(txEventSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
        readTxEvent(txElem.dlc);

        SemaphoreP_pend(rxSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
        rxMessage();

        TEST_ASSERT_EQUAL_INT(1, rxEventCnt);
        TEST_ASSERT_EQUAL_INT(1, txEventCnt);
        TEST_ASSERT_EQUAL_INT(1, txEventAvailCnt);
        TEST_ASSERT_EQUAL_INT(0, txEventFifoLostCnt);
        rxEventCnt      = 0U;
        txEventCnt      = 0U;
        txEventAvailCnt = 0U;
    }

    cleanupTest();
}

/*
 * Tests Tx Event loss by generating more events that the FIFO can hold without
 * reading them out until the end of the test.
 */
void test_canTxEventLost(void)
{
    CAN_Params canParams;
    uint_fast8_t dlc;
    uint_fast8_t i;
    uint_fast8_t txCnt                      = 0U;
    uint_fast8_t expectedTxEventFifoFillCnt = 0U;

    initTest();

    /* Init CAN with a fixed Tx Event FIFO size and message filters */
    CAN_Params_init(&canParams);
    canParams.msgRamConfig = &msgRamConfig;
    canParams.eventCbk     = eventCallback;
    canParams.eventMask    = CAN_EVENT_MASK;
    canHandle              = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    for (dlc = 0U; dlc <= CAN_DLC_64B; dlc++)
    {
        TestProtocol_writeTestContext(dlc);

        /* Use a message ID which is filtered out */
        txMessageWithEvent(TEST_EXT_ID1, 1U, dlc, 1U, 1U);
        txCnt++;

        if (dlc < msgRamConfig.txEventFifoNum)
        {
            expectedTxEventFifoFillCnt += txCnt;
        }
    }

    /* Delay to allow messages to Tx */
    ClockP_usleep(200000);

    TEST_ASSERT_EQUAL_INT(0, rxEventCnt);
    TEST_ASSERT_EQUAL_INT(txCnt, txEventCnt);
    TEST_ASSERT_EQUAL_INT(msgRamConfig.txEventFifoNum, txEventAvailCnt);
    TEST_ASSERT_EQUAL_INT(expectedTxEventFifoFillCnt, txEventFifoFillCnt);
    TEST_ASSERT_EQUAL_INT((txCnt - msgRamConfig.txEventFifoNum), txEventFifoLostCnt);

    dlc = 0U;
    /* Check all stored Tx Events in the FIFO */
    for (i = 0U; i < msgRamConfig.txEventFifoNum; i++)
    {
        readTxEvent(dlc);
        dlc++;
    }

    cleanupTest();
}

/*
 * Tests Tx with raw bit timing set by using loopback mode and
 * comparing the received message. Tx Queue is used.
 */
void test_canTxRawBitTiming(void)
{
    CAN_Params canParams;
    uint_fast8_t dlc;

    initTest();

    /* Init CAN without any msg filters and raw bit rate timing set */
    CAN_Params_init(&canParams);
    canParams.bitTiming = &rawBitTiming;
    canParams.eventCbk  = eventCallback;
    canParams.eventMask = CAN_EVENT_MASK;
    canHandle           = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    for (dlc = 0U; dlc <= CAN_DLC_64B; dlc++)
    {
        TestProtocol_writeTestContext(dlc);
        txMessage(TEST_EXT_ID1, 1U, dlc, 1U, 1U);
        SemaphoreP_pend(rxSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
        rxMessage();

        TEST_ASSERT_EQUAL_INT(1, rxEventCnt);
        TEST_ASSERT_EQUAL_INT(1, txEventCnt);
        rxEventCnt = 0U;
        txEventCnt = 0U;
    }

    cleanupTest();
}

/*
 * Tests message rejection filter by sending messages for every valid data
 * length in loopback mode and verifying nothing is received.
 */
void test_canTxReject(uint32_t in_extID, uint32_t in_canFD, uint32_t in_brs)
{
    CAN_Params canParams;
    uint_fast8_t dlc;
    uint_fast8_t dlcLimit;
    uint32_t id;

    initTest();

    /* Init CAN with msg filters */
    CAN_Params_init(&canParams);
    canParams.msgRamConfig = &msgRamConfig;
    canParams.eventCbk     = eventCallback;
    canParams.eventMask    = CAN_EVENT_MASK;
    canHandle              = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    if (in_canFD == 1U)
    {
        dlcLimit = CAN_DLC_64B;
    }
    else
    {
        dlcLimit = CAN_DLC_8B;
    }

    if (in_extID == 1U)
    {
        id = TEST_EXT_ID1;
    }
    else
    {
        id = TEST_STD_ID1;
    }

    /* Test sending a message with an ID that is not filtered out and verify it
     * is received.
     */
    txMessage(id + 10U, in_extID, CAN_DLC_8B, in_canFD, in_brs);
    SemaphoreP_pend(rxSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
    rxMessage();
    TEST_ASSERT_EQUAL_INT(1, rxEventCnt);
    TEST_ASSERT_EQUAL_INT(1, txEventCnt);
    rxEventCnt = 0U;
    txEventCnt = 0U;

    /* Transmit messages for each DLC. When CAN FD is enabled, this exercises
     * filling the Tx Queue and using the Tx ring buffer.
     */
    for (dlc = 0U; dlc <= dlcLimit; dlc++)
    {
        txMessage(id, in_extID, dlc, in_canFD, in_brs);
    }

    /* Delay to allow messages to Tx */
    ClockP_usleep(200000);

    /* Verify all messages were sent */
    TEST_ASSERT_EQUAL_INT(dlcLimit + 1, txEventCnt);

    /* Verify nothing was received */
    TEST_ASSERT_EQUAL_INT(0, rxEventCnt);

    cleanupTest();
}

/*
 * Tests providing a message RAM config that exceeds the TCAN455X's 2KB message
 * RAM size.
 */
void test_canInvalidMsgRamConfig(void)
{
    CAN_Params canParams;

#if (DeviceFamily_PARENT == DeviceFamily_PARENT_CC27XX)
    /* Message RAM config which exceeds 4KB */
    CAN_MsgRamConfig invalidMsgRamConfig = {
        .stdFilterNum       = STD_MSG_FILTER_NUM,
        .extFilterNum       = EXT_MSG_FILTER_NUM,
        .stdMsgIDFilterList = &stdMsgIDFilter[0],
        .extMsgIDFilterList = &extMsgIDFilter[0],

        .rxFifoNum[0]   = 28U,
        .rxFifoNum[1]   = 5U,
        .rxBufNum       = 2U,
        .txBufNum       = 2U,
        .txFifoQNum     = 20U,
        .txFifoQMode    = 0U,
        .txEventFifoNum = 0U,
    };
#else /* External TCAN455X */
    /* Message RAM config which exceeds 2KB */
    CAN_MsgRamConfig invalidMsgRamConfig = {
        .stdFilterNum       = STD_MSG_FILTER_NUM,
        .extFilterNum       = EXT_MSG_FILTER_NUM,
        .stdMsgIDFilterList = &stdMsgIDFilter[0],
        .extMsgIDFilterList = &extMsgIDFilter[0],

        .rxFifoNum[0]   = 10U,
        .rxFifoNum[1]   = 5U,
        .rxBufNum       = 2U,
        .txBufNum       = 2U,
        .txFifoQNum     = 10U,
        .txFifoQMode    = 0U,
        .txEventFifoNum = 0U,
    };
#endif

    /* Init CAN with invalid msg RAM config */
    CAN_Params_init(&canParams);
    canParams.msgRamConfig = &invalidMsgRamConfig;
    canParams.eventCbk     = eventCallback;
    canParams.eventMask    = CAN_EVENT_MASK;

    canHandle = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NULL(canHandle);

    /* Modify the msg RAM config to make it valid */
    invalidMsgRamConfig.txBufNum = invalidMsgRamConfig.txBufNum - 1U;

    canHandle = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    cleanupTest();
}

/*
 * Tests filling up the Rx Ring buffer.
 */
void test_canFillRxRingBuf(void)
{
    CAN_Params canParams;
    int_fast16_t result;
    int_fast8_t i;

    initTest();

    /* Init CAN without any msg filters */
    CAN_Params_init(&canParams);
    canParams.eventCbk  = eventCallback;
    canParams.eventMask = CAN_EVENT_MASK;
    canHandle           = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    CAN_enableLoopbackExt(canHandle);

    for (i = 0U; i <= CAN_config[0].hwAttrs->rxRingBufSize; i++)
    {
        txMessage(TEST_EXT_ID1 + i, 1U, CAN_DLC_64B, 1U, 0U);
        SemaphoreP_pend(rxSemHandle, (uint32_t)SemaphoreP_WAIT_FOREVER);
    }

    TEST_ASSERT_EQUAL_INT(0, errEventCnt);
    TEST_ASSERT_EQUAL_INT(1, rxBufFullCnt);
    TEST_ASSERT_EQUAL_INT(CAN_config[0].hwAttrs->rxRingBufSize + 1, txEventCnt);

    /* Read messages from Rx ring buffer */
    for (i = 0U; i < CAN_config[0].hwAttrs->rxRingBufSize; i++)
    {
        TestProtocol_writeTestContext(i);
        result = CAN_read(canHandle, &rxElem);
        TEST_ASSERT_EQUAL_INT(CAN_STATUS_SUCCESS, result);

        TEST_ASSERT_EQUAL_INT(TEST_EXT_ID1 + i, rxElem.id);
        TEST_ASSERT_EQUAL_INT(txElem.fdf, rxElem.fdf);
        TEST_ASSERT_EQUAL_INT(txElem.dlc, rxElem.dlc);
        TEST_ASSERT_EQUAL_INT(0, rxElem.esi); /* Assert no error state */
        TEST_ASSERT_EQUAL_INT(0, rxElem.rtr); /* Assert a data frame was Rx'd */

        if (txElem.dlc != 0U)
        {
            TEST_ASSERT_EQUAL_UINT8_ARRAY(txElem.data, rxElem.data, dlcToDataSize[txElem.dlc]);
        }
    }

    cleanupTest();
}

/*
 * Tests filling up the Tx Ring buffer.
 *
 * Note: Ensure CAN device is disconnected from the CAN bus for this test!
 *       The transmitted messages cannot be ACKed when running this test.
 */
void test_canFillTxRingBuf(void)
{
    CAN_Params canParams;
    int_fast16_t result;
    int_fast8_t i;

    initTest();

    /* Init CAN without any msg filters */
    CAN_Params_init(&canParams);
    canParams.eventCbk  = eventCallback;
    canParams.eventMask = CAN_EVENT_MASK;
    canHandle           = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    TEST_ASSERT_GREATER_THAN(0, CAN_config[0].hwAttrs->txRingBufSize);

    for (i = 0U; i < (CAN_config[0].object->txFifoQNum + CAN_config[0].hwAttrs->txRingBufSize); i++)
    {
        TestProtocol_writeTestContext(i);
        txMessage(TEST_EXT_ID1 + i, 1U, CAN_DLC_64B, 1U, 0U);
    }

    result = CAN_write(canHandle, &txElem);
    TEST_ASSERT_EQUAL_INT(CAN_STATUS_TX_BUF_FULL, result);

    cleanupTest();
}

/*
 * Tests opening the CAN driver more than once fails.
 */
void test_canOpenTwice(void)
{
    CAN_Params canParams;

    /* CAN handle used when attempting to open the CAN driver the second time */
    CAN_Handle canHandleExpectNull;

    initTest();

    /* Init CAN without any msg filters */
    CAN_Params_init(&canParams);
    canParams.eventCbk  = eventCallback;
    canParams.eventMask = CAN_EVENT_MASK;

    /* Attempt to open twice, should fail the second time */
    canHandle = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NOT_NULL(canHandle);

    canHandleExpectNull = CAN_open(CONFIG_CAN_0, &canParams);
    TEST_ASSERT_NULL(canHandleExpectNull);

    cleanupTest();
}
