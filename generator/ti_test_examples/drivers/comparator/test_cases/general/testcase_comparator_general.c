/*
 * Copyright (c) 2022, Texas Instruments Incorporated
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
#include <stdbool.h>

/* Driver Header files */
#include <ti/drivers/Comparator.h>
#include "ti_drivers_config.h"

#define NUM_COMPARATOR_CH 4U

Comparator_Handle comparatorHandle[NUM_COMPARATOR_CH] = {NULL};
Comparator_Params comparatorParams;
volatile uint8_t interruptCounter = 0;
volatile bool testFinished        = false;

/*
 *******************************************************************************
 * Common Test Functions
 *******************************************************************************
 */

/* Callback function prototype */
void comparatorCallback(Comparator_Handle handle, int_fast16_t returnValue, Comparator_Trigger trigger);

/*
 *  ======== commonTestOpen ========
 */
static void commonTestOpen(uint8_t in_index)
{
    /* Open Comparator handle */
    comparatorHandle[in_index] = Comparator_open(in_index, &comparatorParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(comparatorHandle[in_index], "Failed to open Comparator Handle");
}

/*
 *  ======== commonTestStartComparator ========
 */
void commonTestStartComparator(uint8_t in_index)
{
    int16_t statusStart;

    /* Initialize the Comparator driver */
    Comparator_init();
    Comparator_Params_init(&comparatorParams);

    /* Open Comparator handle */
    commonTestOpen(in_index);

    /* Enable Comparator handle */
    statusStart = Comparator_start(comparatorHandle[in_index]);
    TEST_ASSERT_EQUAL(Comparator_STATUS_SUCCESS, statusStart);
}

/*
 *******************************************************************************
 * API Tests
 *******************************************************************************
 */

/*
 *  ======== test_openDefaultParams ========
 */
void test_openDefaultParams(void)
{

    /* Initialize the comparator driver */
    Comparator_init();

    /* Attempt to open handle without parameters */
    comparatorHandle[0] = Comparator_open(0, NULL);
    TEST_ASSERT_NOT_NULL(comparatorHandle[0]);

    /* This will clean-up everything */
    Comparator_close(comparatorHandle[0]);
}

/*
 *  ======== test_openTwice ========
 */
void test_openTwice(void)
{
    /* Initialize the comparator driver */
    Comparator_init();
    Comparator_Params_init(&comparatorParams);

    /* This will set-up and open the driver a first time */
    comparatorHandle[0] = Comparator_open(0, &comparatorParams);
    TEST_ASSERT_NOT_NULL_MESSAGE(comparatorHandle[0], "Failed to open Comparator Handle");

    /* Attempt to open twice, should fail */
    comparatorHandle[1] = Comparator_open(0, &comparatorParams);
    TEST_ASSERT_NULL(comparatorHandle[1]);

    /* This will clean-up everything */
    Comparator_close(comparatorHandle[0]);
}

/*
 *  ======== test_setTrigger ========
 */
void test_setTrigger(uint32_t in_index, int in_trigger)
{
    in_trigger = (Comparator_Trigger)in_trigger;
    int16_t statusSetTrigger;

    /* Initialize the comparator driver */
    Comparator_init();
    Comparator_Params_init(&comparatorParams);

    /* Open and start comparator handle */
    commonTestStartComparator(in_index);

    /* Try setting a trigger */
    statusSetTrigger = Comparator_setTrigger(comparatorHandle[in_index], (Comparator_Trigger)in_trigger);
    TEST_ASSERT_EQUAL(Comparator_STATUS_SUCCESS, statusSetTrigger);

    /* Stop and close the handle */
    Comparator_close(comparatorHandle[in_index]);
}

/*
 *  ======== test_getTrigger ========
 */
void test_getTrigger(uint8_t in_index, int in_trigger)
{
    Comparator_Trigger input_trigger = (Comparator_Trigger)in_trigger;
    int16_t statusSetTrigger;
    Comparator_Trigger Trigger;

    /* Initialize the comparator driver */
    Comparator_init();
    Comparator_Params_init(&comparatorParams);

    /* Open and start comparator handle */
    commonTestStartComparator(in_index);

    /* Try setting a trigger */
    statusSetTrigger = Comparator_setTrigger(comparatorHandle[in_index], input_trigger);
    TEST_ASSERT_EQUAL(Comparator_STATUS_SUCCESS, statusSetTrigger);

    Trigger = Comparator_getTrigger(comparatorHandle[in_index]);
    TEST_ASSERT_EQUAL(Trigger, input_trigger);

    /* Stop and close the handle */
    Comparator_close(comparatorHandle[in_index]);
}

/*

 *******************************************************************************
 * Comparator Functional Sequence Tests
 *******************************************************************************
 */

/*
 *  ======== test_comparatorFunctionality ========
 *
 * Tests that the comparator triggers under correct conditions, test getting
 * comparator output levels, and tests changing when the comparator should
 * trigger.
 */
int test_comparatorFunctionality(uint8_t in_index)
{
    Comparator_init();
    Comparator_Params_init(&comparatorParams);

    /* Assign comparatorCallback as the callback for this instance */
    comparatorParams.callbackFxn = (Comparator_CallBackFxn)&comparatorCallback;

    /* Set to trigger an interrupt on rising edge */
    comparatorParams.trigger = Comparator_TRIGGER_RISING;

    /* Open a comparator instance with the paramaters comparatorParams */
    commonTestOpen(in_index);

    /* Start the comparator instance*/
    Comparator_start(comparatorHandle[in_index]);

    /* Run the comparator for exactly 4 interrupts */
    while (testFinished != true) {}
    return interruptCounter;
}

/*
 *  ======== comparatorCallback ========
 */
void comparatorCallback(Comparator_Handle handle, int_fast16_t returnValue, Comparator_Trigger trigger)
{
    Comparator_OutputLevel output_level;
    interruptCounter++;

    /* Toggle the trigger for the comparator on each interrupt */
    if (trigger == Comparator_TRIGGER_RISING)
    {
        output_level = Comparator_getLevel(handle);
        TEST_ASSERT_EQUAL(output_level, Comparator_OUTPUT_HIGH);

        Comparator_setTrigger(handle, Comparator_TRIGGER_FALLING);
        if (interruptCounter == 3)
        {
            Comparator_close(handle);
            testFinished = true;
        }
    }
    else
    {

        output_level = Comparator_getLevel(handle);
        TEST_ASSERT_EQUAL(output_level, Comparator_OUTPUT_LOW);

        Comparator_setTrigger(handle, Comparator_TRIGGER_RISING);
    }
}