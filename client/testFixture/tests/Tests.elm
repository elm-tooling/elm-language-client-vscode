module Tests exposing (suite)

import Expect
import Test exposing (Test, describe, test, todo)


suite : Test
suite =
    describe "native testing"
        [ test "passes" (\_ -> Expect.equal 1 1)
        , test "fails" (\_ -> Expect.equal 1 2)
        , todo "later"
        ]
