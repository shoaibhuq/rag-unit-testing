#include <stdint.h>
#include <unistd.h>

/* Driver Header files */
#include <ti/drivers/GPIO.h>

#include <unity/unity.h>

/* Configuration */
#include "ti_drivers_config.h"

void genericCallback(uint_least8_t id);

/* Not static - these are read from Python */
uint32_t test_gpioCallbackCount       = 0;
/* We should never get this many, but it's nice to be safe */
uint32_t test_gpioCallbackIndexes[10] = {0};

void test_read(uint32_t *out_value_manual, uint32_t *out_value_syscfg)
{
    GPIO_setConfig(CONFIG_GPIO_INPUT_MANUAL, GPIO_CFG_INPUT);

    /* CONFIG_GPIO_LP13 is sysconfig-configured as a generic input */
    *out_value_manual = GPIO_read(CONFIG_GPIO_INPUT_MANUAL);
    *out_value_syscfg = GPIO_read(CONFIG_GPIO_INPUT_SYSCFG);
}

void test_pinCallbacks(void)
{
    /* The IOTH will issue a single high pulse, so a callback should trigger
     * The IOTH should pull this pin high before the test starts
     */
    GPIO_setCallback(CONFIG_GPIO_INPUT_MANUAL, genericCallback);
    /* Test that we can enable interrupts using CFG_INT_ENABLE */
    GPIO_setConfig(CONFIG_GPIO_INPUT_MANUAL, GPIO_CFG_INPUT | GPIO_CFG_IN_INT_FALLING | GPIO_CFG_INT_ENABLE);

    /* This pin is sysconfig-configured (excluding the callback name) so we only
     * set the callback function and enable interrupts
     */
    GPIO_setCallback(CONFIG_GPIO_INPUT_SYSCFG, genericCallback);
    GPIO_enableInt(CONFIG_GPIO_INPUT_SYSCFG);
}

void test_interruptConfig(void)
{
    GPIO_setConfig(CONFIG_GPIO_INPUT_MANUAL, GPIO_CFG_INPUT);

    /* The IOTH will issue a single high pulse, so a callback should trigger
     * The IOTH should pull this pin high before the test starts
     */
    GPIO_setCallback(CONFIG_GPIO_INPUT_MANUAL, genericCallback);

    /* Test that we can configure interrupts using setInterruptConfig */
    GPIO_setInterruptConfig(CONFIG_GPIO_INPUT_MANUAL, GPIO_CFG_IN_INT_RISING | GPIO_CFG_INT_ENABLE);

    /* This pin is sysconfig-configured (excluding the callback name) but we
     * set the callback function and overwrite the existing config.
     */
    GPIO_setCallback(CONFIG_GPIO_INPUT_SYSCFG, genericCallback);
    GPIO_setInterruptConfig(CONFIG_GPIO_INPUT_SYSCFG, GPIO_CFG_IN_INT_RISING | GPIO_CFG_INT_ENABLE);
}

void test_write(uint32_t in_target_value)
{
    /* Configured as output by sysconfig, just write the new value */
    GPIO_write(CONFIG_GPIO_OUTPUT_SYSCFG, in_target_value);

    /* Set value using setConfig defaults */
    in_target_value = in_target_value ? GPIO_CFG_OUT_HIGH : GPIO_CFG_OUT_LOW;
    GPIO_setConfig(CONFIG_GPIO_OUTPUT_MANUAL, GPIO_CFG_OUTPUT | in_target_value);
}

void test_multiInit(void)
{
    GPIO_init();
    GPIO_init();
}

void test_interruptWithoutCallback()
{
    /* Enable interrupts but don't set a callback */
    GPIO_setConfig(CONFIG_GPIO_INPUT_MANUAL, GPIO_CFG_INPUT | GPIO_CFG_IN_INT_FALLING | GPIO_CFG_INT_ENABLE);
}

void test_getConfig()
{
    GPIO_PinConfig readback;
#ifdef DeviceFamily_CC35XX
    /* CC35xx does not support open drain */
    GPIO_PinConfig config = GPIO_CFG_OUT_STD | GPIO_CFG_OUT_LOW | GPIO_CFG_OUT_STR_LOW;
#else
    GPIO_PinConfig config = GPIO_CFG_OUT_OD_PU | GPIO_CFG_OUT_LOW | GPIO_CFG_OUT_STR_LOW;
#endif

#ifdef DeviceFamily_CC23X0R2
    GPIO_setConfig(6, config);
    GPIO_getConfig(6, &readback);
#else
    GPIO_setConfig(5, config);
    GPIO_getConfig(5, &readback);
#endif

    TEST_ASSERT_EQUAL(config, readback);
}

void test_toggle_configure()
{
    GPIO_setConfig(CONFIG_GPIO_OUTPUT_MANUAL, GPIO_CFG_OUTPUT | GPIO_CFG_OUT_LOW);
    GPIO_setConfig(CONFIG_GPIO_OUTPUT_SYSCFG, GPIO_CFG_OUTPUT | GPIO_CFG_OUT_LOW);
}

void test_toggle()
{
    GPIO_toggle(CONFIG_GPIO_OUTPUT_MANUAL);
    GPIO_toggle(CONFIG_GPIO_OUTPUT_SYSCFG);
}

void genericCallback(uint_least8_t id)
{
    test_gpioCallbackIndexes[test_gpioCallbackCount++] = id;
}

void test_disable_interrupt(void)
{
    GPIO_disableInt(CONFIG_GPIO_INPUT_SYSCFG);
}
