#include <stdint.h>
#include <unistd.h>

/* Driver Header files */
#include <ti/drivers/GPIO.h>

#include <unity/unity.h>

/* Configuration */
#include "ti_drivers_config.h"

void cb(uint_least8_t index)
{}

/* This only validates the callback HWI creation logic, not the callback logic */
void test_setMultipleCallbacksSamePort(void)
{
    int_fast16_t status;

    status = GPIO_setConfig(0, GPIO_CFG_IN_NOPULL | GPIO_CFG_IN_INT_BOTH_EDGES);
    TEST_ASSERT_EQUAL(GPIO_STATUS_SUCCESS, status);
    status = GPIO_setConfig(0, GPIO_CFG_IN_NOPULL | GPIO_CFG_IN_INT_BOTH_EDGES);
    TEST_ASSERT_EQUAL(GPIO_STATUS_SUCCESS, status);

    GPIO_setCallback(0, cb);
    GPIO_setCallback(1, cb);

    TEST_ASSERT_EQUAL(cb, GPIO_getCallback(0));
    TEST_ASSERT_EQUAL(cb, GPIO_getCallback(1));
}
