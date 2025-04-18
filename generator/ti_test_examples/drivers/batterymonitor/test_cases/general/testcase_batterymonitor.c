/*
 * Copyright (c) 2022-2023, Texas Instruments Incorporated
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

#include <stdint.h>
#include <string.h>
#include <unistd.h>

#include <ti/drivers/dpl/SemaphoreP.h>
#include <ti/drivers/dpl/HwiP.h>
#include <ti/drivers/BatteryMonitor.h>

#include <unity/unity.h>

#include "testcase_batterymonitor.h"

#define MAX_EXPECTED_VOLTAGE 3600
#define MIN_EXPECTED_VOLTAGE 3000

#define MAGIC_CLIENT_ARG0 0xCAFEF00D
#define MAGIC_CLIENT_ARG1 0xBADDCAFE

#define DEFAULT_SUPPLY_VOLTAGE_OFFSET 500

#define MAX_NOTIFY_COUNT 15

BatteryMonitor_NotifyObj notifyObjects[MAX_NOTIFY_COUNT] = {0};

volatile uint32_t notifyFxnHighCount = 0;
volatile uint32_t notifyFxnLowCount  = 0;

volatile uint32_t notifyFxnReregisterHighCount = 0;
volatile uint32_t notifyFxnReregisterLowCount  = 0;

uint32_t reregisterHighCount = 0;
uint32_t reregisterHighIndex = 0;

/**
 *  Default notificationFxn for high threshold callbacks
 *
 *  If the reregisterHighCount and reregisterHighIndex were set, this function
 *  will reregister its object again at the same thresholdVoltage to
 *  retrigger once more.
 *
 *  @param currentVoltage       Current voltage
 *  @param thresholdVoltage     Threshold that triggered the callback
 *  @param clientArg            Value provided during registration
 *  @param notifyObject         Notification object to reregister or free
 */
void defaultNotifyFxnHigh0(uint16_t currentVoltage,
                           uint16_t thresholdVoltage,
                           uintptr_t clientArg,
                           BatteryMonitor_NotifyObj *notifyObject)
{

    TEST_ASSERT_LESS_THAN(MAX_EXPECTED_VOLTAGE, currentVoltage);
    TEST_ASSERT_GREATER_THAN(MIN_EXPECTED_VOLTAGE, currentVoltage);

    TEST_ASSERT_GREATER_OR_EQUAL_MESSAGE(thresholdVoltage,
                                         currentVoltage,
                                         "Expected threshold lower than current voltage");

    notifyFxnHighCount++;

    /* If there are reregistrations to be done, do them */
    if (notifyFxnReregisterHighCount < reregisterHighCount && notifyObject == &(notifyObjects[reregisterHighIndex]))
    {
        int_fast16_t returnValue;

        returnValue = BatteryMonitor_registerNotifyHigh(notifyObject,
                                                        thresholdVoltage,
                                                        defaultNotifyFxnHigh0,
                                                        MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

        notifyFxnReregisterHighCount++;
    }
}

/**
 *  Default notificationFxn for low threshold callbacks
 *
 *  @param currentVoltage       Current voltage
 *  @param thresholdVoltage     Threshold that triggered the callback
 *  @param clientArg            Value provided during registration
 *  @param notifyObject         Notification object to reregister or free
 */
void defaultNotifyFxnLow0(uint16_t currentVoltage,
                          uint16_t thresholdVoltage,
                          uintptr_t clientArg,
                          BatteryMonitor_NotifyObj *notifyObject)
{

    TEST_ASSERT_LESS_THAN(MAX_EXPECTED_VOLTAGE, currentVoltage);
    TEST_ASSERT_GREATER_THAN(MIN_EXPECTED_VOLTAGE, currentVoltage);

    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(thresholdVoltage,
                                      currentVoltage,
                                      "Expected threshold higher than current voltage");

    notifyFxnLowCount++;
}

/**
 *  Default notificationFxn for range threshold callbacks
 *
 *  This function executes the default high/low notificationFxn depending on
 *  the @c event.
 *
 *  @param currentVoltage       Current voltage
 *  @param thresholdVoltage     Threshold that triggered the callback
 *  @param clientArg            Value provided during registration
 *  @param notifyObject         Notification object to reregister or free
 */
void defaultNotifyFxnRange(uint16_t currentVoltage,
                           uint16_t thresholdVoltage,
                           uintptr_t clientArg,
                           BatteryMonitor_NotifyObj *notifyObject)
{
    /* Execute the correct default notification fxn to ensure validation and
     * counts are correct.
     */
    if (currentVoltage >= thresholdVoltage)
    {
        defaultNotifyFxnHigh0(currentVoltage, thresholdVoltage, clientArg, notifyObject);
    }
    else if (currentVoltage <= thresholdVoltage)
    {
        defaultNotifyFxnLow0(currentVoltage, thresholdVoltage, clientArg, notifyObject);
    }
    else
    {
        TEST_FAIL_MESSAGE("Event in notification was neither high or low");
    }
}

/**
 *  Test that we can register one or multiple high threshold notifications.
 *
 *  @param in_thresholdHigh The high threshold value to use in millivolts
 *  @param in_notifyCount   The number of notifications to register
 *                          [1, MAX_NOTIFY_COUNT]
 */
void test_notifyHigh(uint32_t in_thresholdHigh, uint32_t in_notifyCount)
{
    int_fast16_t returnValue;
    uint32_t i;
    uint32_t key;

    /* Ensure that in_notifyCount is in [1, MAX_NOTIFY_COUNT] */
    TEST_ASSERT_GREATER_THAN(0, in_notifyCount);
    TEST_ASSERT_LESS_THAN(MAX_NOTIFY_COUNT, in_notifyCount);

    BatteryMonitor_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumping to the ISR and working off the list.
     */
    key = HwiP_disable();
    for (i = 0; i < in_notifyCount; i++)
    {

        returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[i],
                                                        (uint16_t)in_thresholdHigh,
                                                        defaultNotifyFxnHigh0,
                                                        MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");
    }
    HwiP_restore(key);

    while (notifyFxnHighCount < in_notifyCount) {}

    TEST_ASSERT_EQUAL_MESSAGE(in_notifyCount, notifyFxnHighCount, "Too many high callbacks executed!");
}

/**
 *  Test that we can register one or multiple low threshold notifications.
 *
 *  @param in_thresholdLow  The low threshold value to use in millivolts
 *  @param in_notifyCount   The number of notifications to register
 *                          [1, MAX_NOTIFY_COUNT]
 */
void test_notifyLow(uint32_t in_thresholdLow, uint32_t in_notifyCount)
{
    int_fast16_t returnValue;
    uint32_t i;
    uint32_t key;

    TEST_ASSERT_NOT_EQUAL(0, in_notifyCount);
    TEST_ASSERT_LESS_THAN(MAX_NOTIFY_COUNT, in_notifyCount);

    BatteryMonitor_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumping to the ISR and working off the list.
     */
    key = HwiP_disable();
    for (i = 0; i < in_notifyCount; i++)
    {

        returnValue = BatteryMonitor_registerNotifyLow(&notifyObjects[i],
                                                       (uint16_t)in_thresholdLow,
                                                       defaultNotifyFxnLow0,
                                                       MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");
    }
    HwiP_restore(key);

    /* Wait until a specified number of notificationFxns have run.
     * The test will time out if we do not run enough notification functions.
     */
    while (notifyFxnLowCount < in_notifyCount) {}

    TEST_ASSERT_EQUAL_MESSAGE(in_notifyCount, notifyFxnLowCount, "Too many low callbacks executed!");
}

/**
 *  Test that we can register both high and low threshold notifications at the
 *  same time.
 *
 *  @param in_thresholdHigh The high threshold value to use in millivolts
 *  @param in_thresholdLow  The low threshold value to use in millivolts
 */
void test_notifyHighAndLow(uint32_t in_thresholdHigh, uint32_t in_thresholdLow)
{
    int_fast16_t returnValue;
    uint32_t key;

    BatteryMonitor_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumping to the ISR and working off the list.
     */
    key = HwiP_disable();

    returnValue = BatteryMonitor_registerNotifyLow(&notifyObjects[0],
                                                   (uint16_t)in_thresholdLow,
                                                   defaultNotifyFxnLow0,
                                                   MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[1],
                                                    (uint16_t)in_thresholdHigh,
                                                    defaultNotifyFxnHigh0,
                                                    MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    returnValue = BatteryMonitor_registerNotifyLow(&notifyObjects[2],
                                                   (uint16_t)in_thresholdLow,
                                                   defaultNotifyFxnLow0,
                                                   MAGIC_CLIENT_ARG1);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[3],
                                                    (uint16_t)in_thresholdHigh,
                                                    defaultNotifyFxnHigh0,
                                                    MAGIC_CLIENT_ARG1);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    HwiP_restore(key);

    /* Wait until a specified number of notificationFxns have run.
     * We need to wait for both the high and the low count.
     * The test will time out if we do not run enough notification functions.
     */
    while (notifyFxnHighCount < 2) {}
    while (notifyFxnLowCount < 2) {}

    TEST_ASSERT_EQUAL_MESSAGE(2, notifyFxnHighCount, "Too many high callbacks executed!");

    TEST_ASSERT_EQUAL_MESSAGE(2, notifyFxnLowCount, "Too many low callbacks executed!");
}

/**
 *  Test to ensure that we can register notifications with a voltage range
 *  rather than just high/low.
 *
 *  @param in_thresholdHigh The high threshold value to use in millivolts
 *  @param in_thresholdLow  The low threshold value to use in millivolts
 */
void test_notifyRange(uint32_t in_thresholdHigh, uint32_t in_thresholdLow)
{
    int_fast16_t returnValue;
    uint32_t key;

    BatteryMonitor_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumpting to the ISR and working off the list.
     */
    key = HwiP_disable();

    returnValue = BatteryMonitor_registerNotifyRange(&notifyObjects[0],
                                                     MAX_EXPECTED_VOLTAGE,
                                                     (uint16_t)in_thresholdLow,
                                                     defaultNotifyFxnLow0,
                                                     MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    returnValue = BatteryMonitor_registerNotifyRange(&notifyObjects[1],
                                                     (uint16_t)in_thresholdHigh,
                                                     MIN_EXPECTED_VOLTAGE,
                                                     defaultNotifyFxnHigh0,
                                                     MAGIC_CLIENT_ARG1);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    returnValue = BatteryMonitor_registerNotifyRange(&notifyObjects[2],
                                                     (uint16_t)in_thresholdHigh,
                                                     (uint16_t)in_thresholdLow,
                                                     defaultNotifyFxnRange,
                                                     MAGIC_CLIENT_ARG1);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    HwiP_restore(key);

    /* Wait until a specified number of notificationFxns have run.
     * We need to wait for both the high and the low count.
     * One of the two counts should reach two but not both.
     * The test will time out if we do not run enough notification functions.
     */
    while (notifyFxnLowCount < 1) {}
    while (notifyFxnHighCount < 1) {}
    while (notifyFxnHighCount < 2 && notifyFxnLowCount < 2) {}

    /* Only one of the counts should reach 2. The other should be 1. */
    uint32_t notifyFxnHighCount_temp = notifyFxnHighCount;
    TEST_ASSERT_EQUAL_MESSAGE(3, notifyFxnHighCount_temp + notifyFxnLowCount, "Too many callbacks executed!");
}

/**
 *  Test that we can reregister a notification at an arbitrary location in the
 *  list an arbitrary number of times.
 *
 *  @param in_thresholdHigh       The high threshold value to use in millivolts
 *  @param in_notifyCount         Number of notifications to initially register
 *  @param in_reregisterHighCount Number times the notification at
 *                                @c in_reregisterHighIndex should be
 *                                reregistered
 *  @param in_reregisterHighIndex Location of the notification within the list
 *                                to be reregistered
 */
void test_notifyReregisterHigh(uint32_t in_thresholdHigh,
                               uint32_t in_notifyCount,
                               uint32_t in_reregisterHighCount,
                               uint32_t in_reregisterHighIndex)
{
    int_fast16_t returnValue;
    uint32_t i;
    uint32_t key;

    reregisterHighCount = in_reregisterHighCount;
    reregisterHighIndex = in_reregisterHighIndex;

    TEST_ASSERT_GREATER_THAN(0, in_notifyCount);
    TEST_ASSERT_LESS_OR_EQUAL(MAX_NOTIFY_COUNT, in_notifyCount);
    TEST_ASSERT_LESS_THAN(in_notifyCount, in_reregisterHighIndex);

    BatteryMonitor_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumping to the ISR and working off the list.
     */
    key = HwiP_disable();
    for (i = 0; i < in_notifyCount; i++)
    {

        returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[i],
                                                        (uint16_t)in_thresholdHigh,
                                                        defaultNotifyFxnHigh0,
                                                        MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");
    }
    HwiP_restore(key);

    while (notifyFxnHighCount < (in_notifyCount + reregisterHighCount)) {}

    TEST_ASSERT_EQUAL_MESSAGE(in_notifyCount + reregisterHighCount,
                              notifyFxnHighCount,
                              "Too many high callbacks executed!");

    TEST_ASSERT_EQUAL_MESSAGE(reregisterHighCount,
                              notifyFxnReregisterHighCount,
                              "Wrong number of reregistrations executed!");
}

/**
 *  Test to ensure that we can unregister a notification at any point in the
 *  notification list.
 *
 *  @param in_thresholdHigh   The high threshold value to use in millivolts
 *  @param in_notifyCount     Total number of notifications to registers before
 *                            unregistering one of them
 *  @param in_unregisterIndex Index of the notification to unregister
 */
void test_notifyUnregister(uint32_t in_thresholdHigh, uint32_t in_notifyCount, uint32_t in_unregisterIndex)
{
    int_fast16_t returnValue;
    uint32_t key;
    uint32_t i;

    TEST_ASSERT_NOT_EQUAL(0, in_notifyCount);
    TEST_ASSERT_LESS_OR_EQUAL(MAX_NOTIFY_COUNT, in_notifyCount);
    TEST_ASSERT_LESS_THAN(in_notifyCount, in_unregisterIndex);

    BatteryMonitor_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumping to the ISR and working off the list. We also need them
     * disabled so we can remove one notification before it is handled.
     */
    key = HwiP_disable();

    for (i = 0; i < in_notifyCount; i++)
    {

        returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[i],
                                                        (uint16_t)in_thresholdHigh,
                                                        defaultNotifyFxnHigh0,
                                                        MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");
    }

    returnValue = BatteryMonitor_unregisterNotify(&notifyObjects[in_unregisterIndex]);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification not unregistered correctly!");

    HwiP_restore(key);

    while (notifyFxnHighCount < (in_notifyCount - 1)) {}

    /* One of the notifications should have been unregistered and thus not run.
     * The notificationFxn should have thus only been invoked in_notifyCount - 1
     * times.
     */
    TEST_ASSERT_LESS_THAN_MESSAGE(in_notifyCount,
                                  notifyFxnHighCount,
                                  "Too many notifications run! Unregistering was not successful!");
}

/**
 *  Get the current supply voltage and return it to the host.
 *
 *  @return Supply voltage in millivolts
 */
uint32_t test_getVoltage()
{

    BatteryMonitor_init();

    uint16_t currentVoltage = BatteryMonitor_getVoltage();

    TEST_ASSERT_LESS_OR_EQUAL(MAX_EXPECTED_VOLTAGE, currentVoltage);
    TEST_ASSERT_GREATER_OR_EQUAL(MIN_EXPECTED_VOLTAGE, currentVoltage);

    return (uint32_t)currentVoltage;
}

/**
 *  Tests the getter for the thresholdHigh on a registered notifyObject.
 */
void test_getThresholdHigh()
{
    int_fast16_t returnValue;
    uint16_t thresholdHigh;
    uint32_t key;

    BatteryMonitor_init();

    key = HwiP_disable();

    uint16_t currentVoltage = BatteryMonitor_getVoltage();

    /* Register a notification with a high threshold significantly above the
     * current supply voltage.
     * It is not supposed to trigger. In the end it does not matter though
     * as the notifyObject should retain its thresholdHigh even after running
     * the notifyFxn.
     */
    returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[0],
                                                    (uint16_t)(currentVoltage + DEFAULT_SUPPLY_VOLTAGE_OFFSET),
                                                    defaultNotifyFxnHigh0,
                                                    MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    HwiP_restore(key);

    thresholdHigh = BatteryMonitor_getThresholdHigh(&notifyObjects[0]);

    TEST_ASSERT_EQUAL_MESSAGE(currentVoltage + DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                              thresholdHigh,
                              "thresholdHigh not identical to originally registered value!");
}

/**
 *  Tests the getter for the thresholdLow on a registered notifyObject.
 */
void test_getThresholdLow()
{
    int_fast16_t returnValue;
    uint16_t thresholdLow;

    BatteryMonitor_init();

    uint16_t currentVoltage = BatteryMonitor_getVoltage();

    /* Register a notification with a high threshold significantly below the
     * current supply voltage.
     * It is not supposed to trigger. In the end it does not matter though
     * as the notifyObject should retain its thresholdLow even after running
     * the notifyFxn.
     */
    returnValue = BatteryMonitor_registerNotifyLow(&notifyObjects[0],
                                                   currentVoltage - DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                                                   defaultNotifyFxnLow0,
                                                   MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    thresholdLow = BatteryMonitor_getThresholdLow(&notifyObjects[0]);

    TEST_ASSERT_EQUAL_MESSAGE(currentVoltage - DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                              thresholdLow,
                              "thresholdLow not identical to originally registered value!");
}

/**
 *  Tests the getter for the high and low thresholds on a registered notifyObject.
 */
void test_getThresholdRange()
{
    int_fast16_t returnValue;
    uint16_t thresholdHigh;
    uint16_t thresholdLow;

    BatteryMonitor_init();

    uint16_t currentVoltage = BatteryMonitor_getVoltage();

    /* Register a notification with a high threshold significantly above the
     * current supply voltage and a low threshold below it.
     * It is not supposed to trigger. In the end it does not matter though
     * as the notifyObject should retain its thresholdLow even after running
     * the notifyFxn.
     */
    returnValue = BatteryMonitor_registerNotifyRange(&notifyObjects[0],
                                                     currentVoltage + DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                                                     currentVoltage - DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                                                     defaultNotifyFxnRange,
                                                     MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    BatteryMonitor_getThresholdRange(&notifyObjects[0], &thresholdHigh, &thresholdLow);

    TEST_ASSERT_EQUAL_MESSAGE(currentVoltage + DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                              thresholdHigh,
                              "thresholdHigh not identical to originally registered value!");

    TEST_ASSERT_EQUAL_MESSAGE(currentVoltage - DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                              thresholdLow,
                              "thresholdLow not identical to originally registered value!");
}

/**
 *  Tests the getter for the clientArg on a registered notifyObject.
 */
void test_getClientArg()
{
    int_fast16_t returnValue;
    uintptr_t clientArg;

    BatteryMonitor_init();

    uint16_t currentVoltage = BatteryMonitor_getVoltage();

    /* Register a notification with a high threshold significantly above the
     * current supply voltage.
     * It is not supposed to trigger. In the end it does not matter though
     * as the notifyObject should retain its thresholdLow even after running
     * the notifyFxn.
     */
    returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[0],
                                                    currentVoltage + DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                                                    defaultNotifyFxnLow0,
                                                    MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    clientArg = BatteryMonitor_getClientArg(&notifyObjects[0]);

    TEST_ASSERT_EQUAL_MESSAGE(MAGIC_CLIENT_ARG0, clientArg, "clientArg not identical to originally registered value!");
}

/**
 *  Tests the getter for the notifyFxn on a registered notifyObject.
 */
void test_getNotifyFxn()
{
    int_fast16_t returnValue;
    BatteryMonitor_NotifyFxn notifyFxn;

    BatteryMonitor_init();

    uint16_t currentVoltage = BatteryMonitor_getVoltage();

    /* Register a notification with a high threshold significantly above the
     * current supply voltage.
     * It is not supposed to trigger. In the end it does not matter though
     * as the notifyObject should retain its thresholdLow even after running
     * the notifyFxn.
     */
    returnValue = BatteryMonitor_registerNotifyHigh(&notifyObjects[0],
                                                    currentVoltage + DEFAULT_SUPPLY_VOLTAGE_OFFSET,
                                                    defaultNotifyFxnHigh0,
                                                    MAGIC_CLIENT_ARG0);

    TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");

    notifyFxn = BatteryMonitor_getNotifyFxn(&notifyObjects[0]);

    TEST_ASSERT_EQUAL_MESSAGE(defaultNotifyFxnHigh0,
                              notifyFxn,
                              "notifyFxn not identical to originally registered value!");
}
