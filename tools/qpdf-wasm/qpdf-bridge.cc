// Copyright (c) 2026 Interleaf contributors
//
// This file is the narrow native boundary used by the qpdf WASM build. Keep
// lossless policy decisions here so the browser worker cannot accidentally
// enable an image-reencoding mode.

#include <qpdf/Pl_Flate.hh>
#include <qpdf/QPDF.hh>
#include <qpdf/QPDFWriter.hh>

#include <cstdlib>
#include <cstring>
#include <exception>
#include <stdexcept>
#include <string>

namespace
{
    char* copy_error(std::string const& message)
    {
        auto const size = message.size() + 1;
        auto* result = static_cast<char*>(std::malloc(size));
        if (result == nullptr) {
            return nullptr;
        }
        std::memcpy(result, message.c_str(), size);
        return result;
    }

    void reset_result(unsigned char** output, size_t* output_size, char** error)
    {
        if (output != nullptr) {
            *output = nullptr;
        }
        if (output_size != nullptr) {
            *output_size = 0;
        }
        if (error != nullptr) {
            *error = nullptr;
        }
    }

    bool has_digital_signature(QPDF& pdf)
    {
        for (auto const& object : pdf.getAllObjects()) {
            auto dictionary = object.isStream() ? object.getDict() : object;
            if (!dictionary.isDictionary()) {
                continue;
            }

            if (dictionary.isDictionaryOfType("/Sig") ||
                (dictionary.hasKey("/ByteRange") && dictionary.hasKey("/Contents"))) {
                return true;
            }
        }
        return false;
    }

    bool supports_object_streams(QPDF& pdf)
    {
        auto const version = pdf.getPDFVersion();
        auto const separator = version.find('.');
        if (separator == std::string::npos) {
            return false;
        }

        try {
            auto const major = std::stoi(version.substr(0, separator));
            auto const minor = std::stoi(version.substr(separator + 1));
            return major > 1 || (major == 1 && minor >= 5);
        } catch (std::exception const&) {
            return false;
        }
    }
}

extern "C"
{
    // Return zero on success. The caller owns output and error and must release
    // both with qpdf_free. A null password means that no password was supplied;
    // a non-null, zero-length password is an explicit empty password.
    int qpdf_optimize(
        unsigned char const* input,
        size_t input_size,
        char const* password,
        size_t password_size,
        unsigned char** output,
        size_t* output_size,
        char** error)
    {
        reset_result(output, output_size, error);

        if (input == nullptr || input_size == 0 || output == nullptr || output_size == nullptr ||
            error == nullptr) {
            if (error != nullptr) {
                *error = copy_error("qpdf received an empty or invalid input buffer");
            }
            return 1;
        }

        try {
            std::string password_value;
            char const* password_argument = nullptr;
            if (password != nullptr) {
                password_value.assign(password, password_size);
                password_argument = password_value.c_str();
            }

            auto pdf = QPDF::create();
            pdf->processMemoryFile(
                "interleaf input.pdf",
                reinterpret_cast<char const*>(input),
                input_size,
                password_argument);

            if (has_digital_signature(*pdf)) {
                throw std::runtime_error("signed PDFs cannot be rewritten losslessly");
            }

            QPDFWriter writer(*pdf);
            writer.setOutputMemory();
            writer.setCompressStreams(true);
            writer.setDecodeLevel(qpdf_dl_specialized);
            writer.setRecompressFlate(true);
            writer.setObjectStreamMode(
                supports_object_streams(*pdf) ? qpdf_o_generate : qpdf_o_preserve);
            writer.setPreserveEncryption(true);

            // This affects only Flate encoding. No lossy decoder or image
            // optimizer is enabled anywhere in this bridge.
            Pl_Flate::setCompressionLevel(9);
            writer.write();

            auto buffer = writer.getBufferSharedPointer();
            auto const size = buffer->getSize();
            auto verification = QPDF::create();
            verification->processMemoryFile(
                "interleaf output.pdf",
                reinterpret_cast<char const*>(buffer->getBuffer()),
                size,
                password_argument);

            auto* data = static_cast<unsigned char*>(std::malloc(size));
            if (data == nullptr && size != 0) {
                *error = copy_error("qpdf could not allocate the output buffer");
                return 2;
            }

            if (size != 0) {
                std::memcpy(data, buffer->getBuffer(), size);
            }
            *output = data;
            *output_size = size;
            return 0;
        } catch (std::exception const& exception) {
            *error = copy_error(exception.what());
            return 3;
        } catch (...) {
            *error = copy_error("qpdf failed with an unknown error");
            return 4;
        }
    }

    void qpdf_free(void* pointer)
    {
        std::free(pointer);
    }
}
