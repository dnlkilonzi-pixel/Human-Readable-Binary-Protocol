/*
 * hrbp_test.c — Cross-language compatibility test for the C port of HRBP.
 *
 * Encodes a fixed set of values and verifies round-trips using the same
 * primitives tested in the JavaScript test suite.
 *
 * Build:
 *   cc -Wall -o hrbp_test hrbp_test.c && ./hrbp_test
 */

#define HRBP_IMPLEMENTATION
#include "hrbp.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

static int g_passed = 0;
static int g_failed = 0;

#define CHECK(cond, msg) \
    do { \
        if (cond) { \
            printf("  PASS: %s\n", msg); \
            g_passed++; \
        } else { \
            printf("  FAIL: %s (line %d)\n", msg, __LINE__); \
            g_failed++; \
        } \
    } while (0)

/* Encode + decode null */
static void test_null(void) {
    uint8_t buf[8];
    int n = hrbp_encode_null(buf, sizeof(buf));
    CHECK(n == 1, "encode_null returns 1");
    CHECK(buf[0] == HRBP_TAG_NULL, "null tag is 0x4E");

    hrbp_value_t v;
    int next = hrbp_decode(buf, (size_t)n, 0, &v);
    CHECK(next == 1, "decode advances by 1");
    CHECK(v.type == HRBP_TYPE_NULL, "decoded type is NULL");
}

/* Encode + decode booleans */
static void test_bool(void) {
    uint8_t buf[2];
    int n;
    hrbp_value_t v;

    n = hrbp_encode_bool(buf, sizeof(buf), 1);
    CHECK(n == 1, "encode_bool true returns 1");
    CHECK(buf[0] == HRBP_TAG_TRUE, "true tag is 0x54");
    hrbp_decode(buf, 1, 0, &v);
    CHECK(v.type == HRBP_TYPE_BOOL && v.v.as_bool == 1, "decoded true");

    n = hrbp_encode_bool(buf, sizeof(buf), 0);
    CHECK(n == 1, "encode_bool false returns 1");
    CHECK(buf[0] == HRBP_TAG_FALSE, "false tag is 0x58");
    hrbp_decode(buf, 1, 0, &v);
    CHECK(v.type == HRBP_TYPE_BOOL && v.v.as_bool == 0, "decoded false");
}

/* Encode + decode INT32 */
static void test_int32(void) {
    uint8_t buf[8];
    hrbp_value_t v;

    int n = hrbp_encode_int32(buf, sizeof(buf), 42);
    CHECK(n == 5, "encode_int32 returns 5");
    CHECK(buf[0] == HRBP_TAG_INT32, "int32 tag is 0x49");
    hrbp_decode(buf, 5, 0, &v);
    CHECK(v.type == HRBP_TYPE_INT32 && v.v.as_int32 == 42, "decoded 42");

    /* Negative */
    hrbp_encode_int32(buf, sizeof(buf), -1);
    hrbp_decode(buf, 5, 0, &v);
    CHECK(v.v.as_int32 == -1, "decoded -1");

    /* INT32_MAX */
    hrbp_encode_int32(buf, sizeof(buf), 2147483647);
    hrbp_decode(buf, 5, 0, &v);
    CHECK(v.v.as_int32 == 2147483647, "decoded INT32_MAX");

    /* INT32_MIN */
    hrbp_encode_int32(buf, sizeof(buf), -2147483648);
    hrbp_decode(buf, 5, 0, &v);
    CHECK(v.v.as_int32 == -2147483648, "decoded INT32_MIN");
}

/* Encode + decode FLOAT */
static void test_float(void) {
    uint8_t buf[12];
    hrbp_value_t v;

    int n = hrbp_encode_float(buf, sizeof(buf), 3.14);
    CHECK(n == 9, "encode_float returns 9");
    CHECK(buf[0] == HRBP_TAG_FLOAT, "float tag is 0x46");
    hrbp_decode(buf, 9, 0, &v);
    CHECK(v.type == HRBP_TYPE_FLOAT, "decoded type is FLOAT");
    /* Allow small floating-point tolerance */
    double diff = v.v.as_float - 3.14;
    CHECK(diff > -1e-10 && diff < 1e-10, "decoded 3.14");
}

/* Encode + decode STRING */
static void test_string(void) {
    uint8_t buf[64];
    hrbp_value_t v;

    const char *str = "hello";
    int n = hrbp_encode_string(buf, sizeof(buf), str, 5);
    CHECK(n == 10, "encode_string 'hello' returns 10");
    CHECK(buf[0] == HRBP_TAG_STRING, "string tag is 0x53");

    hrbp_decode(buf, (size_t)n, 0, &v);
    CHECK(v.type == HRBP_TYPE_STRING, "decoded type is STRING");
    CHECK(v.v.as_string.len == 5, "string length is 5");
    CHECK(memcmp(v.v.as_string.ptr, "hello", 5) == 0, "string content matches");

    /* Empty string */
    n = hrbp_encode_string(buf, sizeof(buf), "", 0);
    CHECK(n == 5, "empty string encodes to 5 bytes");
    hrbp_decode(buf, 5, 0, &v);
    CHECK(v.v.as_string.len == 0, "empty string length is 0");
}

/* Encode + decode BUFFER */
static void test_buffer(void) {
    uint8_t buf[64];
    hrbp_value_t v;

    uint8_t data[] = {0x00, 0x01, 0x02, 0xFF};
    int n = hrbp_encode_buffer(buf, sizeof(buf), data, 4);
    CHECK(n == 9, "encode_buffer 4 bytes returns 9");
    CHECK(buf[0] == HRBP_TAG_BUFFER, "buffer tag is 0x42");

    hrbp_decode(buf, (size_t)n, 0, &v);
    CHECK(v.type == HRBP_TYPE_BUFFER, "decoded type is BUFFER");
    CHECK(v.v.as_buffer.len == 4, "buffer length is 4");
    CHECK(memcmp(v.v.as_buffer.ptr, data, 4) == 0, "buffer content matches");
}

/* Versioned frame encode + decode */
static void test_versioned(void) {
    uint8_t buf[32];
    hrbp_value_t value = { .type = HRBP_TYPE_INT32, .v = { .as_int32 = 99 } };

    int n = hrbp_encode_versioned(buf, sizeof(buf), &value, HRBP_CURRENT_VERSION);
    CHECK(n > 2, "versioned frame is larger than 2 bytes");
    CHECK(buf[0] == HRBP_TAG_HEADER, "versioned frame starts with 0x48");
    CHECK(buf[1] == HRBP_CURRENT_VERSION, "version byte is 1");

    uint8_t version;
    hrbp_value_t decoded;
    int next = hrbp_decode_versioned(buf, (size_t)n, &version, &decoded);
    CHECK(next > 0, "decode_versioned succeeds");
    CHECK(version == HRBP_CURRENT_VERSION, "version round-trips");
    CHECK(decoded.type == HRBP_TYPE_INT32 && decoded.v.as_int32 == 99,
          "value round-trips through versioned frame");
}

/* Error handling */
static void test_errors(void) {
    uint8_t buf[8] = {0xFF}; /* unknown tag */
    hrbp_value_t v;
    int r = hrbp_decode(buf, 1, 0, &v);
    CHECK(r == HRBP_ERR_BAD_TAG, "unknown tag returns HRBP_ERR_BAD_TAG");

    /* Truncated int32 */
    uint8_t trunc[3] = {HRBP_TAG_INT32, 0x00, 0x00};
    r = hrbp_decode(trunc, 3, 0, &v);
    CHECK(r == HRBP_ERR_TRUNCATED, "truncated int32 returns HRBP_ERR_TRUNCATED");

    /* Output buffer too small */
    uint8_t tiny[2];
    r = hrbp_encode_int32(tiny, 2, 42);
    CHECK(r == HRBP_ERR_OVERFLOW, "small output buffer returns HRBP_ERR_OVERFLOW");
}

int main(void) {
    printf("HRBP C port tests\n");
    printf("=================\n\n");

    test_null();
    test_bool();
    test_int32();
    test_float();
    test_string();
    test_buffer();
    test_versioned();
    test_errors();

    printf("\n%d passed, %d failed\n", g_passed, g_failed);
    return g_failed == 0 ? 0 : 1;
}
