const GPIO  = scripting.addModule("/ti/drivers/GPIO");

const GPIO_INP_SYS              = GPIO.addInstance();
GPIO_INP_SYS.$name              = "CONFIG_GPIO_INPUT_SYSCFG";
GPIO_INP_SYS.mode               = "Input";
GPIO_INP_SYS.interruptTrigger   = "Falling Edge";

const GPIO_OUT_SYS              = GPIO.addInstance();
GPIO_OUT_SYS.$name              = "CONFIG_GPIO_OUTPUT_SYSCFG";
GPIO_OUT_SYS.mode               = "Output";
GPIO_OUT_SYS.initialOutputState = "Low";

// Don't configure these pins, but we use this to get device-independent mapping
const GPIO_INP_MAN              = GPIO.addInstance();
GPIO_INP_MAN.$name              = "CONFIG_GPIO_INPUT_MANUAL";

const GPIO_OUT_MAN              = GPIO.addInstance();
GPIO_OUT_MAN.$name              = "CONFIG_GPIO_OUTPUT_MANUAL";

// These pins are common to all devices


/* Loki High */
if (system.deviceData.board.name.match(/CC27/))
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.18";
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.14";
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.15";
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.09";
}
/* Loki Low FPGA have a different pinout */
else if (system.deviceData.board.name.match(/CC2340R2_FPGA/))
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.10"; // DIO11
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.13"; // DIO03
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.4";  // DIO13
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.9"; // DIO8
}
/* Loki Low boards have a different pinout */
else if (system.deviceData.board.name.match(/CC2340R2/) && !system.deviceData.board.name.match(/CC2340R22/))
{
    /* Assumes correct jumper config on board (see LP_EM_CC2340R2.syscfg.json) */
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.7"; // DIO24
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.14"; // DIO21
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.10";  // DIO08
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.9"; // DIO06
}
/* Loki Low++ WCSP have a different pinout */
else if (system.deviceData.board.name.match(/CC2340R53_WCSP/))
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.4";
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.3";
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.15";
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.38";
}
/* Loki Low+ boards have a different pinout */
else if (system.deviceData.board.name.match(/CC23/))
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.18";
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.14";
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.15";
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.38";
}
/* Osprey */
else if (system.deviceData.board.name.match(/CC35/))
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.18";
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.14";
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.15";
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.10";
}
/* P launchpads have a different pinout */
else if (system.deviceData.board.name.match(/CC....P/))
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.19";
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.13";
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.24";
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.23";
}
else
{
    GPIO_INP_MAN.gpioPin.$assign = "boosterpack.19";
    GPIO_OUT_MAN.gpioPin.$assign = "boosterpack.13";
    GPIO_INP_SYS.gpioPin.$assign = "boosterpack.5";
    GPIO_OUT_SYS.gpioPin.$assign = "boosterpack.8";
}