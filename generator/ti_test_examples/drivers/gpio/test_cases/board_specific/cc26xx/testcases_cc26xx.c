#include <stdint.h>
#include <unistd.h>

/* Driver Header files */
#include <ti/drivers/GPIO.h>

#include <unity/unity.h>

/* Configuration */
#include "ti_drivers_config.h"

void test_setAndCheckMiscConfigs(void)
{
    GPIO_PinConfig targetConfig;
    GPIO_PinConfig config;

    targetConfig = GPIO_CFG_INPUT | GPIO_CFG_INVERT_ON | GPIO_CFG_HYSTERESIS_ON;
    GPIO_setConfig(CONFIG_GPIO_INPUT_MANUAL, targetConfig);
    GPIO_getConfig(CONFIG_GPIO_INPUT_MANUAL, &config);
    TEST_ASSERT_EQUAL(targetConfig, config);

    targetConfig = GPIO_CFG_INPUT | GPIO_CFG_SLEW_REDUCED;
    GPIO_setConfig(CONFIG_GPIO_INPUT_MANUAL, targetConfig);
    GPIO_getConfig(CONFIG_GPIO_INPUT_MANUAL, &config);
    TEST_ASSERT_EQUAL(targetConfig, config);

    targetConfig = GPIO_CFG_OUT_OD_PU | GPIO_CFG_OUT_STR_HIGH | GPIO_CFG_OUT_LOW;
    GPIO_setConfig(CONFIG_GPIO_OUTPUT_MANUAL, targetConfig);
    GPIO_getConfig(CONFIG_GPIO_OUTPUT_MANUAL, &config);
    TEST_ASSERT_EQUAL(targetConfig, config);

    targetConfig = GPIO_CFG_OUT_OD_PD | GPIO_CFG_INVERT_ON;
    GPIO_setConfig(CONFIG_GPIO_OUTPUT_MANUAL, targetConfig);
    GPIO_getConfig(CONFIG_GPIO_OUTPUT_MANUAL, &config);
    TEST_ASSERT_EQUAL(targetConfig, config);
}

void test_readback(void)
{
    // Syscfg starts this off low
    TEST_ASSERT_EQUAL(0, GPIO_read(CONFIG_GPIO_OUTPUT_SYSCFG));

    GPIO_write(CONFIG_GPIO_OUTPUT_SYSCFG, 1);
    TEST_ASSERT_EQUAL(1, GPIO_read(CONFIG_GPIO_OUTPUT_SYSCFG));

    GPIO_write(CONFIG_GPIO_OUTPUT_SYSCFG, 0);
    TEST_ASSERT_EQUAL(0, GPIO_read(CONFIG_GPIO_OUTPUT_SYSCFG));
}
