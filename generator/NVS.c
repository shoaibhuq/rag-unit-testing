/*
 *  ======== NVS.c ========
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include <ti/drivers/NVS.h>
#include <ti/drivers/dpl/HwiP.h>

extern NVS_Config NVS_config[];
extern const uint8_t NVS_count;

static bool isInitialized = false;

/* Default NVS parameters structure */
const NVS_Params NVS_defaultParams = {
    NULL /* custom */
};

/*
 *  ======== NVS_close =======
 */
void NVS_close(NVS_Handle handle) { handle->fxnTablePtr->closeFxn(handle); }

/*
 *  ======== NVS_control ========
 */
int_fast16_t NVS_control(NVS_Handle handle, uint_fast16_t cmd, uintptr_t arg) {
  return (handle->fxnTablePtr->controlFxn(handle, cmd, arg));
}

/*
 *  ======== NVS_erase =======
 */
int_fast16_t NVS_erase(NVS_Handle handle, size_t offset, size_t size) {
  return (handle->fxnTablePtr->eraseFxn(handle, offset, size));
}

/*
 *  ======== NVS_getAttrs =======
 */
void NVS_getAttrs(NVS_Handle handle, NVS_Attrs *attrs) {
  handle->fxnTablePtr->getAttrsFxn(handle, attrs);
}

/*
 *  ======== NVS_init =======
 */
void NVS_init(void) {
  uint_least8_t i;

  /* Call each driver's init function */
  for (i = 0; i < NVS_count; i++) {
    NVS_config[i].fxnTablePtr->initFxn();
  }

  isInitialized = true;
}

/*
 *  ======== NVS_lock =======
 */
int_fast16_t NVS_lock(NVS_Handle handle, uint32_t timeout) {
  return (handle->fxnTablePtr->lockFxn(handle, timeout));
}

/*
 *  ======== NVS_open =======
 */
NVS_Handle NVS_open(uint_least8_t index, NVS_Params *params) {
  NVS_Handle handle = NULL;

  /* do init if not done yet */
  if (!isInitialized) {
    NVS_init();
  }

  if (index < NVS_count) {
    if (params == NULL) {
      /* No params passed in, so use the defaults */
      params = (NVS_Params *)&NVS_defaultParams;
    }
    handle = NVS_config[index].fxnTablePtr->openFxn(index, params);
  }

  return (handle);
}

/*
 *  ======== NVS_Params_init =======
 */
void NVS_Params_init(NVS_Params *params) { *params = NVS_defaultParams; }

/*
 *  ======== NVS_read =======
 */
int_fast16_t NVS_read(NVS_Handle handle, size_t offset, void *buffer,
                      size_t bufferSize) {
  return (handle->fxnTablePtr->readFxn(handle, offset, buffer, bufferSize));
}

/*
 *  ======== NVS_unlock =======
 */
void NVS_unlock(NVS_Handle handle) { handle->fxnTablePtr->unlockFxn(handle); }

/*
 *  ======== NVS_write =======
 */
int_fast16_t NVS_write(NVS_Handle handle, size_t offset, void *buffer,
                       size_t bufferSize, uint_fast16_t flags) {
  return (
      handle->fxnTablePtr->writeFxn(handle, offset, buffer, bufferSize, flags));
}
