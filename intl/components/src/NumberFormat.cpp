/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "mozilla/intl/NumberFormat.h"
#include "NumberFormatFields.h"
#include "NumberFormatterSkeleton.h"
#include "ScopedICUObject.h"

#include "unicode/unumberformatter.h"
#include "unicode/upluralrules.h"

namespace mozilla {
namespace intl {

/*static*/ Result<UniquePtr<NumberFormat>, ICUError> NumberFormat::TryCreate(
    std::string_view aLocale, const NumberFormatOptions& aOptions) {
  UniquePtr<NumberFormat> nf = MakeUnique<NumberFormat>();
  Result<Ok, ICUError> result = nf->initialize(aLocale, aOptions);
  if (result.isOk()) {
    return nf;
  }

  return Err(result.unwrapErr());
}

NumberFormat::~NumberFormat() {
  if (mFormattedNumber) {
    unumf_closeResult(mFormattedNumber);
  }
  if (mNumberFormatter) {
    unumf_close(mNumberFormatter);
  }
}

Result<Ok, ICUError> NumberFormat::initialize(
    std::string_view aLocale, const NumberFormatOptions& aOptions) {
  mFormatForUnit = aOptions.mUnit.isSome();
  NumberFormatterSkeleton skeleton(aOptions);
  mNumberFormatter = skeleton.toFormatter(aLocale);
  if (mNumberFormatter) {
    UErrorCode status = U_ZERO_ERROR;
    mFormattedNumber = unumf_openResult(&status);
    if (U_SUCCESS(status)) {
      return Ok();
    }
  }
  return Err(ICUError::InternalError);
}

Result<int32_t, ICUError> NumberFormat::selectFormatted(
    double number, char16_t* keyword, int32_t keywordSize,
    UPluralRules* pluralRules) const {
  MOZ_ASSERT(keyword && pluralRules);
  UErrorCode status = U_ZERO_ERROR;

  if (format(number).isErr()) {
    return Err(ICUError::InternalError);
  }

  int32_t utf16KeywordLength = uplrules_selectFormatted(
      pluralRules, mFormattedNumber, keyword, keywordSize, &status);

  if (U_FAILURE(status)) {
    return Err(ICUError::InternalError);
  }

  return utf16KeywordLength;
}

bool NumberFormat::formatInternal(double number) const {
  // ICU incorrectly formats NaN values with the sign bit set, as if they
  // were negative.  Replace all NaNs with a single pattern with sign bit
  // unset ("positive", that is) until ICU is fixed.
  if (MOZ_UNLIKELY(IsNaN(number))) {
    number = SpecificNaN<double>(0, 1);
  }

  UErrorCode status = U_ZERO_ERROR;
  unumf_formatDouble(mNumberFormatter, number, mFormattedNumber, &status);
  return U_SUCCESS(status);
}

bool NumberFormat::formatInternal(int64_t number) const {
  UErrorCode status = U_ZERO_ERROR;
  unumf_formatInt(mNumberFormatter, number, mFormattedNumber, &status);
  return U_SUCCESS(status);
}

bool NumberFormat::formatInternal(std::string_view number) const {
  UErrorCode status = U_ZERO_ERROR;
  unumf_formatDecimal(mNumberFormatter, number.data(), number.size(),
                      mFormattedNumber, &status);
  return U_SUCCESS(status);
}

Result<std::u16string_view, ICUError> NumberFormat::formatResult() const {
  UErrorCode status = U_ZERO_ERROR;

  const UFormattedValue* formattedValue =
      unumf_resultAsValue(mFormattedNumber, &status);
  if (U_FAILURE(status)) {
    return Err(ICUError::InternalError);
  }

  int32_t utf16Length;
  const char16_t* utf16Str =
      ufmtval_getString(formattedValue, &utf16Length, &status);
  if (U_FAILURE(status)) {
    return Err(ICUError::InternalError);
  }

  return std::u16string_view(utf16Str, static_cast<size_t>(utf16Length));
}

}  // namespace intl
}  // namespace mozilla
