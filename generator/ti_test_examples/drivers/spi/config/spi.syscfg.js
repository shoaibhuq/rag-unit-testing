var board = system.deviceData.board.name;

const SPI  = scripting.addModule("/ti/drivers/SPI");
const SPI1 = SPI.addInstance();
SPI1.$name                = "CONFIG_SPI_0";
SPI1.mode                 = "Four Pin CS Active Low";

/* ======== SPI ======== */
if (board.match(/CC(13|26).[34]/))
{
    SPI1.$hardware            = system.deviceData.board.components.LP_SPI;

    if (board.match(/CC(13|26).3/))
    {
        /* Only one SPI module on this device */
        SPI1.spi.$assign = "SPI1";
    }
    else
    {
        SPI1.spi.$assign = "SPI0";

        /* This device has two SPI modules, so set up for the multi-instance tests */
        const SPI2       = SPI.addInstance();
        SPI2.$name       = "CONFIG_SPI_1";
        SPI2.mode        = "Four Pin CS Active Low";
        SPI2.spi.$assign = "SPI1";
    }

    SPI1.sclkPinInstance.mode = "Input";
    SPI1.picoPinInstance.mode = "Input";
    SPI1.csnPinInstance.mode  = "Input";
    SPI1.csnPinInstance.pull  = "Pull Up";
}
else if (board.match(/CC(13|26)/))
{
    SPI1.$hardware            = system.deviceData.board.components.LP_SPI;
    SPI1.spi.$assign          = "SSI0";
    SPI1.sclkPinInstance.mode = "Input";
    SPI1.picoPinInstance.mode = "Input";
    SPI1.csnPinInstance.mode  = "Input";
    SPI1.csnPinInstance.interruptTrigger = "Falling Edge";
    SPI1.csnPinInstance.pull   = "Pull Up";

    if (!board.match(/CC(13|26).1/))
    {
        const SPI2 = SPI.addInstance();
        SPI2.$name = "CONFIG_SPI_1";
        SPI2.mode = "Four Pin CS Active Low";
        SPI2.spi.$assign = "SSI1";
    }
}
else if (board.match(/CC2340R53_WCSP/))
{
    SPI1.spi.$assign          = "SPI0";
    SPI1.sclkPinInstance.mode = "Input";
    SPI1.picoPinInstance.mode = "Input";
    SPI1.csnPinInstance.mode  = "Input";
    SPI1.csnPinInstance.pull  = "Pull Up";

    /* Unstack IOTH and DUT, then manually jump the pins according to
     * https://frwvosbuild.norway.design.ti.com/job/FW-SLATE-BuildTestDeploy/job/slate/job/stable/Documentation/user_guide/ioth.html#id4
     */
    SPI1.spi.sclkPin.$assign  = "boosterpack.7";
    SPI1.spi.pociPin.$assign  = "boosterpack.14";
    SPI1.spi.picoPin.$assign  = "boosterpack.15";
    SPI1.spi.csnPin.$assign   = "boosterpack.4";
}
else if (board.match(/CC23/) || board.match(/CC27/))
{
    SPI1.$hardware            = system.deviceData.board.components.LP_SPI;
    SPI1.spi.$assign           = "SPI0";
    SPI1.sclkPinInstance.mode  = "Input";
    SPI1.picoPinInstance.mode  = "Input";
    SPI1.csnPinInstance.mode   = "Input";
    SPI1.csnPinInstance.pull   = "Pull Up";

    if (board.match(/CC27/) && !board.match(/Q1/))
    {
        /* This device has two SPI modules, so set up for the multi-instance tests */
        const SPI2       = SPI.addInstance();
        SPI2.$name       = "CONFIG_SPI_1";
        SPI2.mode        = "Four Pin CS Active Low";
        SPI2.spi.$assign = "SPI1";
    }
}
else if (board.match(/CC35.*FPGA/))
{
    SPI1.$hardware             = system.deviceData.board.components.LP_SPI1;
    SPI1.spi.$assign           = "SPI1";
    SPI1.sclkPinInstance.mode  = "Input";
    SPI1.picoPinInstance.mode  = "Input";
    SPI1.csnPinInstance.mode   = "Input";
    SPI1.csnPinInstance.pull   = "Pull Up";
}
else if (board.match(/CC35.*LAUNCHXL/))
{
    SPI1.$hardware             = system.deviceData.board.components.LP_SPI0;
    SPI1.spi.$assign           = "SPI0";
    SPI1.sclkPinInstance.mode  = "Input";
    SPI1.picoPinInstance.mode  = "Input";
    SPI1.csnPinInstance.mode   = "Input";
    SPI1.csnPinInstance.pull   = "Pull Up";
}
