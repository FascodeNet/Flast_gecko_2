/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: set ts=8 sts=2 et sw=2 tw=80:
 *
 * Copyright 2021 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef wasm_frame_h
#define wasm_frame_h

#include "mozilla/Assertions.h"

#include <stddef.h>
#include <stdint.h>
#include <type_traits>

namespace js {
namespace wasm {

struct TlsData;

// Bit set as the lowest bit of a frame pointer, used in two different mutually
// exclusive situations:
// - either it's a low bit tag in a FramePointer value read from the
// Frame::callerFP of an inner wasm frame. This indicates the previous call
// frame has been set up by a JIT caller that directly called into a wasm
// function's body. This is only stored in Frame::callerFP for a wasm frame
// called from JIT code, and thus it can not appear in a JitActivation's
// exitFP.
// - or it's the low big tag set when exiting wasm code in JitActivation's
// exitFP.

constexpr uintptr_t ExitOrJitEntryFPTag = 0x1;

// wasm::Frame represents the bytes pushed by the call instruction and the
// fixed prologue generated by wasm::GenerateCallablePrologue.
//
// Across all architectures it is assumed that, before the call instruction, the
// stack pointer is WasmStackAlignment-aligned. Thus after the prologue, and
// before the function has made its stack reservation, the stack alignment is
// sizeof(Frame) % WasmStackAlignment.
//
// During MacroAssembler code generation, the bytes pushed after the wasm::Frame
// are counted by masm.framePushed. Thus, the stack alignment at any point in
// time is (sizeof(wasm::Frame) + masm.framePushed) % WasmStackAlignment.

class Frame {
  // See GenerateCallableEpilogue for why this must be
  // the first field of wasm::Frame (in a downward-growing stack).
  // It's either the caller's Frame*, for wasm callers, or the JIT caller frame
  // plus a tag otherwise.
  uint8_t* callerFP_;

  // The return address pushed by the call (in the case of ARM/MIPS the return
  // address is pushed by the first instruction of the prologue).
  void* returnAddress_;

 public:
  static constexpr uint32_t callerFPOffset() {
    return offsetof(Frame, callerFP_);
  }
  static constexpr uint32_t returnAddressOffset() {
    return offsetof(Frame, returnAddress_);
  }

  uint8_t* returnAddress() const {
    return reinterpret_cast<uint8_t*>(returnAddress_);
  }

  void** addressOfReturnAddress() {
    return reinterpret_cast<void**>(&returnAddress_);
  }

  uint8_t* rawCaller() const { return callerFP_; }

  Frame* wasmCaller() const {
    MOZ_ASSERT(!callerIsExitOrJitEntryFP());
    return reinterpret_cast<Frame*>(callerFP_);
  }

  bool callerIsExitOrJitEntryFP() const {
    return isExitOrJitEntryFP(callerFP_);
  }

  uint8_t* jitEntryCaller() const { return toJitEntryCaller(callerFP_); }

  static const Frame* fromUntaggedWasmExitFP(const void* savedFP) {
    MOZ_ASSERT(!isExitOrJitEntryFP(savedFP));
    return reinterpret_cast<const Frame*>(savedFP);
  }

  static bool isExitOrJitEntryFP(const void* fp) {
    return reinterpret_cast<uintptr_t>(fp) & ExitOrJitEntryFPTag;
  }

  static uint8_t* toJitEntryCaller(const void* fp) {
    MOZ_ASSERT(isExitOrJitEntryFP(fp));
    return reinterpret_cast<uint8_t*>(reinterpret_cast<uintptr_t>(fp) &
                                      ~ExitOrJitEntryFPTag);
  }

  static uint8_t* addExitOrJitEntryFPTag(const Frame* fp) {
    MOZ_ASSERT(!isExitOrJitEntryFP(fp));
    return reinterpret_cast<uint8_t*>(reinterpret_cast<uintptr_t>(fp) |
                                      ExitOrJitEntryFPTag);
  }
};

static_assert(!std::is_polymorphic_v<Frame>, "Frame doesn't need a vtable.");
static_assert(sizeof(Frame) == 2 * sizeof(void*),
              "Frame is a two pointer structure");

class FrameWithTls : public Frame {
  TlsData* calleeTls_;
  TlsData* callerTls_;

 public:
  TlsData* calleeTls() { return calleeTls_; }
  TlsData* callerTls() { return callerTls_; }

  constexpr static uint32_t sizeWithoutFrame() {
    return sizeof(wasm::FrameWithTls) - sizeof(wasm::Frame);
  }

  constexpr static uint32_t calleeTLSOffset() {
    return offsetof(FrameWithTls, calleeTls_) - sizeof(wasm::Frame);
  }

  constexpr static uint32_t callerTLSOffset() {
    return offsetof(FrameWithTls, callerTls_) - sizeof(wasm::Frame);
  }
};

static_assert(FrameWithTls::calleeTLSOffset() == 0u,
              "Callee tls stored right above the return address.");
static_assert(FrameWithTls::callerTLSOffset() == sizeof(void*),
              "Caller tls stored right above the callee tls.");

static_assert(FrameWithTls::sizeWithoutFrame() == 2 * sizeof(void*),
              "There are only two additional slots");

#if defined(JS_CODEGEN_ARM64)
static_assert(sizeof(Frame) % 16 == 0, "frame is aligned");
#endif

}  // namespace wasm
}  // namespace js

#endif  // wasm_frame_h
