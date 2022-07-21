export const POOL_DEPLOYER_ADDRESS =
  '0x218a510d4d6aEA897961ab6Deb74443521A88839';

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

export const POOL_INIT_CODE_HASH =
  '0x6f8da21644d39435fbc8337b1031e14292c1d5a0042041eb303b6145c64c0a16';
export const POOL_INIT_CODE_HASH_OPTIMISM =
  '0x0c231002d0970d2126e7e00ce88c3b0e5ec8e48dac71478d56245c34ea2f9447';

// historical artifact due to small compiler mismatch
export const POOL_INIT_CODE_HASH_OPTIMISM_KOVAN =
  '0x75540cffbf6fa0f7384d7cd847b36e21a896b818798ea322666054ba953ae16a';

/**
 * The default factory enabled fee amounts, denominated in hundredths of bips.
 */
export enum FeeAmount {
  LOW = 500,
  MEDIUM = 500,
  HIGH = 500,
}

/**
 * The default factory tick spacings by fee amount.
 */
export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 60,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 60,
};