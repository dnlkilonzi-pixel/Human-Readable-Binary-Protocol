/**
 * hrbp.h — Human-Readable Binary Protocol (C port, v1)
 *
 * Single-header C99 implementation of the HRBP wire format.
 * Matches SPEC.md exactly.
 *
 * Include with:
 *   #include "hrbp.h"
 *
 * Or define HRBP_IMPLEMENTATION in exactly ONE translation unit before
 * the include to compile the function bodies:
 *   #define HRBP_IMPLEMENTATION
 *   #include "hrbp.h"
 */

#ifndef HRBP_H
#define HRBP_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* -------------------------------------------------------------------------
 * Type tags
 * ---------------------------------------------------------------------- */

#define HRBP_TAG_INT32   0x49  /* 'I' */
#define HRBP_TAG_FLOAT   0x46  /* 'F' */
#define HRBP_TAG_STRING  0x53  /* 'S' */
#define HRBP_TAG_TRUE    0x54  /* 'T' */
#define HRBP_TAG_FALSE   0x58  /* 'X' */
#define HRBP_TAG_NULL    0x4E  /* 'N' */
#define HRBP_TAG_ARRAY   0x5B  /* '[' */
#define HRBP_TAG_OBJECT  0x7B  /* '{' */
#define HRBP_TAG_BUFFER  0x42  /* 'B' */
#define HRBP_TAG_HEADER  0x48  /* 'H' */

#define HRBP_CURRENT_VERSION     1
#define HRBP_MAX_SUPPORTED_VERSION 1

/* -------------------------------------------------------------------------
 * Result / error codes
 * ---------------------------------------------------------------------- */

typedef enum {
    HRBP_OK            =  0,
    HRBP_ERR_OVERFLOW  = -1,  /* output buffer too small          */
    HRBP_ERR_TRUNCATED = -2,  /* input buffer ended unexpectedly  */
    HRBP_ERR_BAD_TAG   = -3,  /* unknown type tag                 */
    HRBP_ERR_BAD_KEY   = -4,  /* object key is not a string       */
    HRBP_ERR_VERSION   = -5,  /* unsupported protocol version     */
    HRBP_ERR_ARG       = -6,  /* invalid argument                 */
} hrbp_err_t;

/* -------------------------------------------------------------------------
 * Value representation
 * ---------------------------------------------------------------------- */

typedef enum {
    HRBP_TYPE_NULL,
    HRBP_TYPE_BOOL,
    HRBP_TYPE_INT32,
    HRBP_TYPE_FLOAT,
    HRBP_TYPE_STRING,
    HRBP_TYPE_BUFFER,
    HRBP_TYPE_ARRAY,
    HRBP_TYPE_OBJECT,
} hrbp_type_t;

/* Forward declaration for recursive structs. */
typedef struct hrbp_value hrbp_value_t;
typedef struct hrbp_kv    hrbp_kv_t;

struct hrbp_kv {
    const char    *key;         /* UTF-8 key string (not owned)   */
    hrbp_value_t  *value;       /* pointer to value (not owned)   */
};

struct hrbp_value {
    hrbp_type_t type;
    union {
        int           as_bool;   /* 0 = false, 1 = true             */
        int32_t       as_int32;
        double        as_float;
        struct { const char   *ptr; uint32_t len; } as_string;
        struct { const uint8_t *ptr; uint32_t len; } as_buffer;
        struct { hrbp_value_t **items; uint32_t count; } as_array;
        struct { hrbp_kv_t    *pairs; uint32_t count; } as_object;
    } v;
};

/* -------------------------------------------------------------------------
 * Encoder API
 *
 * All encode_* functions write into `out[0..cap-1]` and return the number of
 * bytes written, or a negative hrbp_err_t on error.
 * ---------------------------------------------------------------------- */

int hrbp_encode_null   (uint8_t *out, size_t cap);
int hrbp_encode_bool   (uint8_t *out, size_t cap, int value);
int hrbp_encode_int32  (uint8_t *out, size_t cap, int32_t value);
int hrbp_encode_float  (uint8_t *out, size_t cap, double value);
int hrbp_encode_string (uint8_t *out, size_t cap, const char *str, uint32_t len);
int hrbp_encode_buffer (uint8_t *out, size_t cap, const uint8_t *data, uint32_t len);
int hrbp_encode_value  (uint8_t *out, size_t cap, const hrbp_value_t *value);

/* Versioned frame encoder. */
int hrbp_encode_versioned(uint8_t *out, size_t cap, const hrbp_value_t *value,
                          uint8_t version);

/* -------------------------------------------------------------------------
 * Decoder API
 *
 * hrbp_decode reads one value starting at buf[offset] and fills *value_out.
 * Returns the new offset (number of bytes consumed from the start of buf) on
 * success, or a negative hrbp_err_t on error.
 *
 * String and buffer payloads point directly into `buf` (zero-copy); the
 * caller must keep `buf` alive for the lifetime of the decoded value.
 * ---------------------------------------------------------------------- */

int hrbp_decode(const uint8_t *buf, size_t len, size_t offset,
                hrbp_value_t *value_out);

/* Versioned frame decoder.  Fills *version_out and *value_out. */
int hrbp_decode_versioned(const uint8_t *buf, size_t len,
                          uint8_t *version_out, hrbp_value_t *value_out);

/* -------------------------------------------------------------------------
 * Utility: big-endian write helpers (also used by implementation)
 * ---------------------------------------------------------------------- */

static inline void hrbp_write_u32be(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)(v >> 24);
    p[1] = (uint8_t)(v >> 16);
    p[2] = (uint8_t)(v >>  8);
    p[3] = (uint8_t)(v      );
}

static inline uint32_t hrbp_read_u32be(const uint8_t *p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
           ((uint32_t)p[2] <<  8) |  (uint32_t)p[3];
}

static inline void hrbp_write_i32be(uint8_t *p, int32_t v) {
    hrbp_write_u32be(p, (uint32_t)v);
}

static inline int32_t hrbp_read_i32be(const uint8_t *p) {
    return (int32_t)hrbp_read_u32be(p);
}

/* Write/read IEEE 754 double in big-endian byte order. */
static inline void hrbp_write_f64be(uint8_t *p, double v) {
    uint64_t bits;
    memcpy(&bits, &v, 8);
    p[0] = (uint8_t)(bits >> 56); p[1] = (uint8_t)(bits >> 48);
    p[2] = (uint8_t)(bits >> 40); p[3] = (uint8_t)(bits >> 32);
    p[4] = (uint8_t)(bits >> 24); p[5] = (uint8_t)(bits >> 16);
    p[6] = (uint8_t)(bits >>  8); p[7] = (uint8_t)(bits      );
}

static inline double hrbp_read_f64be(const uint8_t *p) {
    uint64_t bits =
        ((uint64_t)p[0] << 56) | ((uint64_t)p[1] << 48) |
        ((uint64_t)p[2] << 40) | ((uint64_t)p[3] << 32) |
        ((uint64_t)p[4] << 24) | ((uint64_t)p[5] << 16) |
        ((uint64_t)p[6] <<  8) |  (uint64_t)p[7];
    double v;
    memcpy(&v, &bits, 8);
    return v;
}

/* -------------------------------------------------------------------------
 * Implementation (compiled only when HRBP_IMPLEMENTATION is defined)
 * ---------------------------------------------------------------------- */

#ifdef HRBP_IMPLEMENTATION

int hrbp_encode_null(uint8_t *out, size_t cap) {
    if (cap < 1) return HRBP_ERR_OVERFLOW;
    out[0] = HRBP_TAG_NULL;
    return 1;
}

int hrbp_encode_bool(uint8_t *out, size_t cap, int value) {
    if (cap < 1) return HRBP_ERR_OVERFLOW;
    out[0] = value ? HRBP_TAG_TRUE : HRBP_TAG_FALSE;
    return 1;
}

int hrbp_encode_int32(uint8_t *out, size_t cap, int32_t value) {
    if (cap < 5) return HRBP_ERR_OVERFLOW;
    out[0] = HRBP_TAG_INT32;
    hrbp_write_i32be(out + 1, value);
    return 5;
}

int hrbp_encode_float(uint8_t *out, size_t cap, double value) {
    if (cap < 9) return HRBP_ERR_OVERFLOW;
    out[0] = HRBP_TAG_FLOAT;
    hrbp_write_f64be(out + 1, value);
    return 9;
}

int hrbp_encode_string(uint8_t *out, size_t cap, const char *str, uint32_t len) {
    if (cap < (size_t)(5 + len)) return HRBP_ERR_OVERFLOW;
    out[0] = HRBP_TAG_STRING;
    hrbp_write_u32be(out + 1, len);
    memcpy(out + 5, str, len);
    return (int)(5 + len);
}

int hrbp_encode_buffer(uint8_t *out, size_t cap, const uint8_t *data, uint32_t len) {
    if (cap < (size_t)(5 + len)) return HRBP_ERR_OVERFLOW;
    out[0] = HRBP_TAG_BUFFER;
    hrbp_write_u32be(out + 1, len);
    memcpy(out + 5, data, len);
    return (int)(5 + len);
}

int hrbp_encode_value(uint8_t *out, size_t cap, const hrbp_value_t *v) {
    if (!v) return HRBP_ERR_ARG;
    switch (v->type) {
        case HRBP_TYPE_NULL:
            return hrbp_encode_null(out, cap);
        case HRBP_TYPE_BOOL:
            return hrbp_encode_bool(out, cap, v->v.as_bool);
        case HRBP_TYPE_INT32:
            return hrbp_encode_int32(out, cap, v->v.as_int32);
        case HRBP_TYPE_FLOAT:
            return hrbp_encode_float(out, cap, v->v.as_float);
        case HRBP_TYPE_STRING:
            return hrbp_encode_string(out, cap,
                                      v->v.as_string.ptr, v->v.as_string.len);
        case HRBP_TYPE_BUFFER:
            return hrbp_encode_buffer(out, cap,
                                      v->v.as_buffer.ptr, v->v.as_buffer.len);
        case HRBP_TYPE_ARRAY: {
            if (cap < 5) return HRBP_ERR_OVERFLOW;
            uint32_t count = v->v.as_array.count;
            out[0] = HRBP_TAG_ARRAY;
            hrbp_write_u32be(out + 1, count);
            size_t off = 5;
            for (uint32_t i = 0; i < count; i++) {
                int n = hrbp_encode_value(out + off, cap - off, v->v.as_array.items[i]);
                if (n < 0) return n;
                off += (size_t)n;
            }
            return (int)off;
        }
        case HRBP_TYPE_OBJECT: {
            if (cap < 5) return HRBP_ERR_OVERFLOW;
            uint32_t count = v->v.as_object.count;
            out[0] = HRBP_TAG_OBJECT;
            hrbp_write_u32be(out + 1, count);
            size_t off = 5;
            for (uint32_t i = 0; i < count; i++) {
                const hrbp_kv_t *kv = &v->v.as_object.pairs[i];
                uint32_t klen = (uint32_t)strlen(kv->key);
                int n = hrbp_encode_string(out + off, cap - off, kv->key, klen);
                if (n < 0) return n;
                off += (size_t)n;
                n = hrbp_encode_value(out + off, cap - off, kv->value);
                if (n < 0) return n;
                off += (size_t)n;
            }
            return (int)off;
        }
    }
    return HRBP_ERR_ARG;
}

int hrbp_encode_versioned(uint8_t *out, size_t cap, const hrbp_value_t *value,
                           uint8_t version) {
    if (cap < 2) return HRBP_ERR_OVERFLOW;
    out[0] = HRBP_TAG_HEADER;
    out[1] = version;
    int n = hrbp_encode_value(out + 2, cap - 2, value);
    if (n < 0) return n;
    return 2 + n;
}

/* --- Decoder ---------------------------------------------------------- */

int hrbp_decode(const uint8_t *buf, size_t len, size_t offset,
                hrbp_value_t *out) {
    if (!buf || !out) return HRBP_ERR_ARG;
    if (offset >= len) return HRBP_ERR_TRUNCATED;

    uint8_t tag = buf[offset++];

    switch (tag) {
        case HRBP_TAG_NULL:
            out->type = HRBP_TYPE_NULL;
            return (int)offset;

        case HRBP_TAG_TRUE:
            out->type = HRBP_TYPE_BOOL;
            out->v.as_bool = 1;
            return (int)offset;

        case HRBP_TAG_FALSE:
            out->type = HRBP_TYPE_BOOL;
            out->v.as_bool = 0;
            return (int)offset;

        case HRBP_TAG_INT32:
            if (offset + 4 > len) return HRBP_ERR_TRUNCATED;
            out->type = HRBP_TYPE_INT32;
            out->v.as_int32 = hrbp_read_i32be(buf + offset);
            return (int)(offset + 4);

        case HRBP_TAG_FLOAT:
            if (offset + 8 > len) return HRBP_ERR_TRUNCATED;
            out->type = HRBP_TYPE_FLOAT;
            out->v.as_float = hrbp_read_f64be(buf + offset);
            return (int)(offset + 8);

        case HRBP_TAG_STRING: {
            if (offset + 4 > len) return HRBP_ERR_TRUNCATED;
            uint32_t slen = hrbp_read_u32be(buf + offset);
            offset += 4;
            if (offset + slen > len) return HRBP_ERR_TRUNCATED;
            out->type = HRBP_TYPE_STRING;
            out->v.as_string.ptr = (const char *)(buf + offset);
            out->v.as_string.len = slen;
            return (int)(offset + slen);
        }

        case HRBP_TAG_BUFFER: {
            if (offset + 4 > len) return HRBP_ERR_TRUNCATED;
            uint32_t blen = hrbp_read_u32be(buf + offset);
            offset += 4;
            if (offset + blen > len) return HRBP_ERR_TRUNCATED;
            out->type = HRBP_TYPE_BUFFER;
            out->v.as_buffer.ptr = buf + offset;
            out->v.as_buffer.len = blen;
            return (int)(offset + blen);
        }

        /* Arrays and objects are decoded shallowly: only their count and
         * the current offset are recorded.  Full recursive decoding would
         * require dynamic memory allocation; callers can iterate manually. */
        case HRBP_TAG_ARRAY: {
            if (offset + 4 > len) return HRBP_ERR_TRUNCATED;
            /* Return the count in as_array.count and skip elements inline. */
            uint32_t count = hrbp_read_u32be(buf + offset);
            offset += 4;
            out->type = HRBP_TYPE_ARRAY;
            out->v.as_array.count = count;
            out->v.as_array.items = NULL; /* caller decodes elements */
            /* Skip past each element to find the end offset. */
            for (uint32_t i = 0; i < count; i++) {
                hrbp_value_t tmp;
                int next = hrbp_decode(buf, len, offset, &tmp);
                if (next < 0) return next;
                offset = (size_t)next;
            }
            return (int)offset;
        }

        case HRBP_TAG_OBJECT: {
            if (offset + 4 > len) return HRBP_ERR_TRUNCATED;
            uint32_t count = hrbp_read_u32be(buf + offset);
            offset += 4;
            out->type = HRBP_TYPE_OBJECT;
            out->v.as_object.count = count;
            out->v.as_object.pairs = NULL;
            for (uint32_t i = 0; i < count; i++) {
                hrbp_value_t key, val;
                int next = hrbp_decode(buf, len, offset, &key);
                if (next < 0) return next;
                if (key.type != HRBP_TYPE_STRING) return HRBP_ERR_BAD_KEY;
                offset = (size_t)next;
                next = hrbp_decode(buf, len, offset, &val);
                if (next < 0) return next;
                offset = (size_t)next;
            }
            return (int)offset;
        }

        default:
            return HRBP_ERR_BAD_TAG;
    }
}

int hrbp_decode_versioned(const uint8_t *buf, size_t len,
                           uint8_t *version_out, hrbp_value_t *value_out) {
    if (!buf || !version_out || !value_out) return HRBP_ERR_ARG;
    if (len < 2) return HRBP_ERR_TRUNCATED;
    if (buf[0] != HRBP_TAG_HEADER) return HRBP_ERR_BAD_TAG;
    uint8_t version = buf[1];
    if (version > HRBP_MAX_SUPPORTED_VERSION) return HRBP_ERR_VERSION;
    *version_out = version;
    int next = hrbp_decode(buf, len, 2, value_out);
    return next;
}

#endif /* HRBP_IMPLEMENTATION */

#endif /* HRBP_H */
