// Copyright (c) 2012 Ecma International.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
es5id: 11.2.3-3_3
description: >
    Call arguments are not evaluated before the check is made to see
    if the object is actually callable (undefined member)
---*/

    var fooCalled = false;
    function foo(){ fooCalled = true; } 
    
    var o = { }; 
assert.throws(TypeError, function() {
        o.bar.gar( foo() );
        throw new Test262Error("o.bar does not exist!");
});
assert.sameValue(fooCalled, false, 'fooCalled');

reportCompare(0, 0);
