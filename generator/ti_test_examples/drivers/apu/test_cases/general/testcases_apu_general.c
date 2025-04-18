/*
 * Copyright (c) 2024, Texas Instruments Incorporated
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

#include "unity/unity.h"

#include <stdlib.h>

#include <ti/drivers/dpl/SemaphoreP.h>
#include <ti/drivers/dpl/HwiP.h>
#include <ti/drivers/dpl/ClockP.h>
#include <ti/drivers/apu/APULPF3.h>

#include "testcase_apu_common.h"

#include "ti_drivers_config.h"

#include <ti/devices/DeviceFamily.h>
#include DeviceFamily_constructPath(inc/hw_memmap.h)

/*
 *  ======== test_dot_product ========
 */

volatile float complex resultBuffer[1024];
volatile float complex argA[INPUT_SIZE];
volatile float complex argB[INPUT_SIZE];
volatile uint16_t L;
volatile uint16_t iter;
volatile float tresh;

volatile uint16_t numPoints;
volatile uint16_t constant;
volatile uint16_t phase;
volatile uint16_t conjugate;

void test_dot_product(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};
    APULPF3_ComplexVector vecB = {.data = (float complex *)argB, .size = VEC_SIZE};

    APULPF3_dotProduct(&vecA, &vecB, false, (float complex *)resultBuffer);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_elem_product ========
 */
void test_elem_product(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};
    APULPF3_ComplexVector vecB = {.data = (float complex *)argB, .size = VEC_SIZE};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};
    APULPF3_vectorMult(&vecA, &vecB, false, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_vector_sum ========
 */
void test_vector_sum(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};
    APULPF3_ComplexVector vecB = {.data = (float complex *)argB, .size = VEC_SIZE};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    APULPF3_vectorSum(&vecA, &vecB, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_mul_matrix_matrix ========
 */
void test_mul_matrix_matrix(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};
    APULPF3_ComplexMatrix matB = {.data = (float complex *)argB, .rows = MAT_B_ROWS, .cols = MAT_B_COLS};

    APULPF3_ComplexMatrix resultMat = {.data = (float complex *)resultBuffer, .rows = MAT_A_ROWS, .cols = MAT_B_COLS};

    APULPF3_matrixMult(&matA, &matB, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_mul_vector_matrix ========
 */
void test_mul_vector_matrix(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = 1, .cols = MAT_A_COLS};
    APULPF3_ComplexMatrix matB = {.data = (float complex *)argB, .rows = MAT_B_ROWS, .cols = MAT_B_COLS};

    APULPF3_ComplexMatrix resultMat = {.data = (float complex *)resultBuffer, .rows = 1, .cols = MAT_B_COLS};

    APULPF3_matrixMult(&matA, &matB, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_add_matrix_matrix ========
 */
void test_add_matrix_matrix(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};
    APULPF3_ComplexMatrix matB = {.data = (float complex *)argB, .rows = MAT_B_ROWS, .cols = MAT_B_COLS};

    APULPF3_ComplexMatrix resultMat = {.data = (float complex *)resultBuffer, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};

    APULPF3_matrixSum(&matA, &matB, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_mul_matrix_scalar ========
 */
void test_mul_matrix_scalar(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};

    APULPF3_ComplexMatrix resultMat = {.data = (float complex *)resultBuffer, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};

    APULPF3_matrixScalarMult(&matA, (float complex *)argB, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_add_matrix_scalar ========
 */
void test_add_matrix_scalar(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};

    APULPF3_ComplexMatrix resultMat = {.data = (float complex *)resultBuffer, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};

    APULPF3_matrixScalarSum(&matA, (float complex *)argB, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_convert_cart_to_polar ========
 */
void test_convert_cart_to_polar(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    APULPF3_cartesianToPolarVector(&vecA, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_convert_polar_to_cart ========
 */
void test_convert_polar_to_cart(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};

    float complex *temp = (float complex *)APURAM_DATA0_BASE + 2 * vecA.size;

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    APULPF3_polarToCartesianVector(&vecA, temp, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_sort_vector ========
 */
void test_sort_vector(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    APULPF3_sortVector(&vecA, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_covariance_matrix ========
 */
void test_covariance_matrix(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector matA = {.data = (float complex *)argA, .size = VEC_SIZE};

    APULPF3_ComplexTriangleMatrix resultMat = {.data = (float complex *)resultBuffer, .size = L};

    APULPF3_covMatrixSpatialSmoothing(&matA, L, false, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_eigenvalues ========
 */
void test_eigenvalues_and_vectors(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexTriangleMatrix matA = {.data = (float complex *)argA, .size = MAT_A_ROWS};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer,
                                       .size = MAT_A_ROWS * MAT_A_ROWS + ((MAT_A_ROWS * MAT_A_ROWS + MAT_A_ROWS) / 2)};

    /* Read volatile variables sequentially to avoid compiler warnings */
    float threshold        = tresh;
    uint16_t maxIterations = iter;
    APULPF3_jacobiEVD(&matA, maxIterations, threshold, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_matrix_inverse ========
 */
void test_matrix_inverse(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = MAT_A_ROWS, .cols = 2 * MAT_A_COLS};

    APULPF3_ComplexMatrix resultMat = {.data = (float complex *)resultBuffer,
                                       .rows = MAT_A_ROWS,
                                       .cols = 2 * MAT_A_COLS};

    APULPF3_gaussJordanElim(&matA, 0.0005, &resultMat);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_matrix_norm ========
 */
void test_matrix_norm(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexMatrix matA = {.data = (float complex *)argA, .rows = MAT_A_ROWS, .cols = MAT_A_COLS};

    APULPF3_matrixNorm(&matA, (float complex *)resultBuffer);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_vector_dft ========
 */
void test_vector_dft(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    APULPF3_computeFFT(&vecA, false, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_vector_idft ========
 */
void test_vector_idft(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector vecA = {.data = (float complex *)argA, .size = VEC_SIZE};

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    APULPF3_computeFFT(&vecA, true, &resultVec);

    APULPF3_stopOperationSequence();
}

/*
 *  ======== test_unit_circle ========
 */
void test_unit_circle(void)
{
    APULPF3_init();
    APULPF3_startOperationSequence();

    APULPF3_ComplexVector resultVec = {.data = (float complex *)resultBuffer, .size = VEC_SIZE};

    /* Read volatile variables sequentially to avoid compiler warnings */
    uint16_t nPoints  = numPoints;
    uint16_t theConst = constant;
    uint16_t thePhase = phase;
    uint16_t theConj  = conjugate;
    APULPF3_unitCircle(nPoints, theConst, thePhase, theConj, &resultVec);

    APULPF3_stopOperationSequence();
}
