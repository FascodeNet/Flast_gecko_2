// This file was procedurally generated from the following sources:
// - src/insignificant-input-elements/paragraph-separator.case
// - src/insignificant-input-elements/expression/after-regular-expression-literal.template
/*---
description: U+2029 PARAGRAPH SEPARATOR <PS> (after regular expression literal)
esid: sec-lexical-and-regexp-grammars
flags: [generated]
info: |
    Input elements other than white space and comments form the terminal symbols
    for the syntactic grammar for ECMAScript and are called ECMAScript
    <em>tokens</em>. These tokens are the reserved words, identifiers, literals,
    and punctuators of the ECMAScript language. Moreover, line terminators,
    although not considered to be tokens, also become part of the stream of input
    elements and guide the process of automatic semicolon insertion
    (<emu-xref href="#sec-automatic-semicolon-insertion"></emu-xref>). Simple
    white space and single-line comments are discarded and do not appear in the
    stream of input elements for the syntactic grammar. A |MultiLineComment| (that
    is, a comment of the form `/*`&hellip;`*``/` regardless of whether it spans more
    than one line) is likewise simply discarded if it contains no line terminator;
    but if a |MultiLineComment| contains one or more line terminators, then it is
    replaced by a single line terminator, which becomes part of the stream of
    input elements for the syntactic grammar.

    <tr>
      <td>
        `U+2029`
      </td>
      <td>
        PARAGRAPH SEPARATOR
      </td>
      <td>
        &lt;PS&gt;
      </td>
    </tr>

    LineTerminator ::
      &lt;LF&gt;
      &lt;CR&gt;
      &lt;LS&gt;
      &lt;PS&gt;
---*/


/x/g ;

reportCompare(0, 0);
