/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This header contains functions that give information about the Profiler state
// with regards to the current thread.

#ifndef ProfilerThreadState_h
#define ProfilerThreadState_h

#include "mozilla/ProfilerState.h"
#include "mozilla/ProfilerThreadRegistration.h"
#include "mozilla/ProfilerThreadRegistry.h"

// During profiling, if the current thread is registered, return true
// (regardless of whether it is actively being profiled).
// (Same caveats and recommented usage as profiler_is_active().)
[[nodiscard]] inline bool profiler_is_active_and_thread_is_registered() {
  return profiler_is_active() &&
         mozilla::profiler::ThreadRegistration::IsRegistered();
}

// Is the profiler active, and is the current thread being profiled?
// (Same caveats and recommented usage as profiler_is_active().)
[[nodiscard]] inline bool profiler_thread_is_being_profiled() {
  return profiler_is_active() &&
         mozilla::profiler::ThreadRegistration::WithOnThreadRefOr(
             [](mozilla::profiler::ThreadRegistration::OnThreadRef aTR) {
               return aTR.UnlockedConstReaderAndAtomicRWCRef()
                   .IsBeingProfiled();
             },
             false);
  ;
}

// Is the current thread registered and sleeping?
[[nodiscard]] inline bool profiler_thread_is_sleeping() {
  return profiler_is_active() &&
         mozilla::profiler::ThreadRegistration::WithOnThreadRefOr(
             [](mozilla::profiler::ThreadRegistration::OnThreadRef aTR) {
               return aTR.UnlockedConstReaderAndAtomicRWCRef().IsSleeping();
             },
             false);
}

#endif  // ProfilerThreadState_h
