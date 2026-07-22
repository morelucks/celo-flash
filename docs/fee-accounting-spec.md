# Fee Withdrawal & End-to-End Accounting Specification


# Fee Withdrawal & End-to-End Accounting Specification

- Verified withdrawFees and withdrawHouseEdge execution paths.


- Protocol Fee Formula: (entryFee * participantCount * PROTOCOL_FEE_BPS) / 10000


- House Edge Formula: (grossPayout * HOUSE_EDGE_BPS) / 10000


- Solvency Invariant: contract.balance >= totalPendingLiabilities + accumulatedHouseEdge


### Fee Accounting Note (tournament)
- Objective: Implement accumulatedFees pool state tracking
- Verification: Passed end-to-end accounting invariants
- Security: Validated against fund leak and solvency rules
