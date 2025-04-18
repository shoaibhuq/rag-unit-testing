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
#include <ti/drivers/Temperature.h>

#include <unity/unity.h>

#include "testcase_batterymonitor_lpf3.h"

#define MAX_NOTIFY_COUNT 15

#define MAGIC_CLIENT_ARG0 0xCAFEF00D
#define MAGIC_CLIENT_ARG1 0xBADDCAFE

#define MAX_EXPECTED_VOLTAGE 4000 // TODO: Choose value
#define MIN_EXPECTED_VOLTAGE 2000 // TODO: Choose value

#define DEFAULT_SUPPLY_VOLTAGE_OFFSET 500 // TODO: Choose value

BatteryMonitor_NotifyObj batteryMonitorNotifyObjects[MAX_NOTIFY_COUNT] = {0};
Temperature_NotifyObj temperatureNotifyObjects[MAX_NOTIFY_COUNT]       = {0};

volatile uint32_t batteryMonitorNotifyFxnLowCount = 0;
volatile uint32_t temperatureNotifyFxnLowCount    = 0;

/**
 *  Default Battery Monitor notificationFxn for low threshold callbacks
 *
 *  @param currentVoltage       Current voltage
 *  @param thresholdVoltage     Threshold that triggered the callback
 *  @param clientArg            Value provided during registration
 *  @param notifyObject         Notification object to reregister or free
 */
void defaultBatteryMonitorNotifyFxnLow0(uint16_t currentVoltage,
                                        uint16_t thresholdVoltage,
                                        uintptr_t clientArg,
                                        BatteryMonitor_NotifyObj *notifyObject)
{

    TEST_ASSERT_LESS_THAN(MAX_EXPECTED_VOLTAGE, currentVoltage);
    TEST_ASSERT_GREATER_THAN(MIN_EXPECTED_VOLTAGE, currentVoltage);

    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(thresholdVoltage,
                                      currentVoltage,
                                      "Expected threshold higher than current voltage");

    batteryMonitorNotifyFxnLowCount++;
}

/**
 *  Default Temperature notificationFxn for low threshold callbacks
 *
 *  @param currentTemperature   Current temperature
 *  @param thresholdTemperature Threshold that triggered the callback
 *  @param clientArg            Value provided during registration
 *  @param notifyObject         Notification object to reregister or free
 */
void defaultTemperatureNotifyFxnLow0(int16_t currentTemperature,
                                     int16_t thresholdTemperature,
                                     uintptr_t clientArg,
                                     Temperature_NotifyObj *notifyObject)
{

    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(thresholdTemperature,
                                      currentTemperature,
                                      "Expected threshold higher than current temp");

    temperatureNotifyFxnLowCount++;
}

/**
 *  Get the current ambient temperature and return it to the host.
 *
 *  This is not used to test the getTemperature function of the Temperature
 *  driver. It is used as a way for the host to get the current temperature.
 *
 *  @return Ambient temperature in degrees C
 */
uint32_t test_getTemperature()
{

    Temperature_init();

    int16_t currentTemperature = Temperature_getTemperature();

    return (uint32_t)currentTemperature;
}

/**
 *  Test that we can register one or multiple low threshold notifications in both the Battery Monitor driver and the
 * Temperature driver.
 *
 *  The purpose of this test is to make sure that the BATMON resource which is used by both drivers can be shared by the
 * two drivers.
 *
 *  @param in_batteryMonitorThresholdLow    The Battery Monitor low threshold value to use in millivolts
 *  @param in_batteryMonitorNotifyCount     The number of notifications to register for the Battery Monitor
 *                                          [1, MAX_NOTIFY_COUNT]
 *  @param in_temperatureThresholdLow       The Temperature low threshold value to use in millivolts
 *  @param in_temperatureNotifyCount        The number of notifications to register for the Temperature driver
 *                                          [1, MAX_NOTIFY_COUNT]
 */
void test_batteryMonitorNotifyLowAndTemperatureNotifyLow(uint32_t in_batteryMonitorThresholdLow,
                                                         uint32_t in_batteryMonitorNotifyCount,
                                                         uint32_t in_temperatureThresholdLow,
                                                         uint32_t in_temperatureNotifyCount)
{
    int_fast16_t returnValue;
    uint32_t i;
    uint32_t key;

    TEST_ASSERT_NOT_EQUAL(0, in_batteryMonitorNotifyCount + in_temperatureNotifyCount);
    TEST_ASSERT_LESS_THAN(MAX_NOTIFY_COUNT, in_batteryMonitorNotifyCount);
    TEST_ASSERT_LESS_THAN(MAX_NOTIFY_COUNT, in_temperatureNotifyCount);

    BatteryMonitor_init();
    Temperature_init();

    /* Disable interrupts so that we can finish registering out notifications
     * before jumping to the ISR and working off the list.
     */
    key = HwiP_disable();
    for (i = 0; i < in_batteryMonitorNotifyCount; i++)
    {

        returnValue = BatteryMonitor_registerNotifyLow(&batteryMonitorNotifyObjects[i],
                                                       (uint16_t)in_batteryMonitorThresholdLow,
                                                       defaultBatteryMonitorNotifyFxnLow0,
                                                       MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(BatteryMonitor_STATUS_SUCCESS, returnValue, "Notification registration failed!");
    }
    for (i = 0; i < in_temperatureNotifyCount; i++)
    {

        returnValue = Temperature_registerNotifyLow(&temperatureNotifyObjects[i],
                                                    (uint16_t)in_temperatureThresholdLow,
                                                    defaultTemperatureNotifyFxnLow0,
                                                    MAGIC_CLIENT_ARG0);

        TEST_ASSERT_EQUAL_MESSAGE(Temperature_STATUS_SUCCESS, returnValue, "Notification registration failed!");
    }
    HwiP_restore(key);

    /* Wait until a specified number of notificationFxns have run.
     * The test will time out if we do not run enough notification functions.
     */
    while (batteryMonitorNotifyFxnLowCount < in_batteryMonitorNotifyCount &&
           temperatureNotifyFxnLowCount < in_temperatureNotifyCount)
    {}

    TEST_ASSERT_EQUAL_MESSAGE(in_batteryMonitorNotifyCount,
                              batteryMonitorNotifyFxnLowCount,
                              "Too many Battery Monitor low callbacks executed!");
    TEST_ASSERT_EQUAL_MESSAGE(in_temperatureNotifyCount,
                              temperatureNotifyFxnLowCount,
                              "Too many Temperature low callbacks executed!");
}
