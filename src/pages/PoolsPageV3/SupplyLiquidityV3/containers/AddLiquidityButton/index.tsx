import React, { useCallback, useMemo, useState } from 'react';
import { useV3NFTPositionManagerContract } from 'hooks/useContract';
import useTransactionDeadline from 'hooks/useTransactionDeadline';
import { useActiveWeb3React } from 'hooks';
import { useIsExpertMode, useUserSlippageTolerance } from 'state/user/hooks';
import { NonfungiblePositionManager as NonFunPosMan } from 'v3lib/nonfungiblePositionManager';
import { Percent, Currency } from '@uniswap/sdk-core';
import { useAppDispatch, useAppSelector } from 'state/hooks';
import { GAS_PRICE_MULTIPLIER } from 'hooks/useGasPrice';
import {
  useAllTransactions,
  useTransactionAdder,
  useTransactionFinalizer,
} from 'state/transactions/hooks';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import {
  IDerivedMintInfo,
  useAddLiquidityTxHash,
  useInitialUSDPrices,
} from 'state/mint/v3/hooks';
import { ApprovalState, useApproveCallback } from 'hooks/useV3ApproveCallback';
import { Field } from 'state/mint/actions';
import { Bound, setAddLiquidityTxHash } from 'state/mint/v3/actions';
import { ZERO_PERCENT } from 'constants/v3/misc';
import { useIsNetworkFailedImmediate } from 'hooks/v3/useIsNetworkFailed';
import { JSBI } from '@uniswap/sdk';
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'constants/v3/addresses';
import { calculateGasMarginV3 } from 'utils';
import { Button, Box } from '@material-ui/core';
import { Error } from '@material-ui/icons';
import {
  ConfirmationModalContent,
  CurrencyLogo,
  DoubleCurrencyLogo,
  TransactionConfirmationModal,
  TransactionErrorContent,
} from 'components';
import './index.scss';
import {
  PriceFormats,
  PriceFormatToggler,
} from '../../components/PriceFomatToggler';
import useUSDCPrice, { useUSDCValue } from 'hooks/v3/useUSDCPrice';
import { tryParseAmount } from 'state/swap/v3/hooks';
import RangeBadge from 'components/v3/Badge/RangeBadge';

interface IAddLiquidityButton {
  baseCurrency: Currency | undefined;
  quoteCurrency: Currency | undefined;
  mintInfo: IDerivedMintInfo;
  handleAddLiquidity: () => void;
  title: string;
  setRejected?: (rejected: boolean) => void;
}
const DEFAULT_ADD_IN_RANGE_SLIPPAGE_TOLERANCE = new Percent(50, 10_000);

export function AddLiquidityButton({
  baseCurrency,
  quoteCurrency,
  mintInfo,
  handleAddLiquidity,
  title,
  setRejected,
}: IAddLiquidityButton) {
  const { chainId, library, account } = useActiveWeb3React();
  const [showConfirm, setShowConfirm] = useState(false);
  const [attemptingTxn, setAttemptingTxn] = useState(false);
  const [priceFormat, setPriceFormat] = useState(PriceFormats.TOKEN);
  const [txPending, setTxPending] = useState(false);
  const [addLiquidityErrorMessage, setAddLiquidityErrorMessage] = useState<
    string | null
  >(null);

  const positionManager = useV3NFTPositionManagerContract();

  const deadline = useTransactionDeadline();

  const dispatch = useAppDispatch();

  const txHash = useAddLiquidityTxHash();

  const expertMode = useIsExpertMode();

  const isNetworkFailed = useIsNetworkFailedImmediate();

  const [allowedSlippage] = useUserSlippageTolerance();
  const allowedSlippagePercent: Percent = useMemo(() => {
    return new Percent(JSBI.BigInt(allowedSlippage), JSBI.BigInt(10000));
  }, [allowedSlippage]);

  const gasPrice = useAppSelector((state) => {
    if (!state.application.gasPrice.fetched) return 36;
    return state.application.gasPrice.override
      ? 36
      : state.application.gasPrice.fetched;
  });

  const addTransaction = useTransactionAdder();
  const finalizedTransaction = useTransactionFinalizer();

  const [approvalA] = useApproveCallback(
    mintInfo.parsedAmounts[Field.CURRENCY_A],
    chainId ? NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId] : undefined,
  );
  const [approvalB] = useApproveCallback(
    mintInfo.parsedAmounts[Field.CURRENCY_B],
    chainId ? NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId] : undefined,
  );

  const isReady = useMemo(() => {
    return Boolean(
      (mintInfo.depositADisabled
        ? true
        : approvalA === ApprovalState.APPROVED) &&
        (mintInfo.depositBDisabled
          ? true
          : approvalB === ApprovalState.APPROVED) &&
        !mintInfo.errorMessage &&
        !mintInfo.invalidRange &&
        !txHash &&
        !isNetworkFailed,
    );
  }, [mintInfo, approvalA, approvalB]);

  const onAddLiquidity = () => {
    if (expertMode) {
      onAdd();
    } else {
      setShowConfirm(true);
    }
  };

  const handleDismissConfirmation = useCallback(() => {
    setShowConfirm(false);
    setAddLiquidityErrorMessage('');
    dispatch(setAddLiquidityTxHash({ txHash: '' }));
  }, [dispatch]);

  async function onAdd() {
    if (!chainId || !library || !account) return;

    if (!positionManager || !baseCurrency || !quoteCurrency) {
      return;
    }

    if (mintInfo.position && account && deadline) {
      const useNative = baseCurrency.isNative
        ? baseCurrency
        : quoteCurrency.isNative
        ? quoteCurrency
        : undefined;

      const { calldata, value } = NonFunPosMan.addCallParameters(
        mintInfo.position,
        {
          slippageTolerance: allowedSlippagePercent,
          recipient: account,
          deadline: deadline.toString(),
          useNative,
          createPool: mintInfo.noLiquidity,
        },
      );

      const txn: { to: string; data: string; value: string } = {
        to: NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId],
        data: calldata,
        value,
      };

      setRejected && setRejected(false);

      setAttemptingTxn(true);

      library
        .getSigner()
        .estimateGas(txn)
        .then((estimate) => {
          const newTxn = {
            ...txn,
            gasLimit: calculateGasMarginV3(chainId, estimate),
            gasPrice: gasPrice * GAS_PRICE_MULTIPLIER,
          };

          return library
            .getSigner()
            .sendTransaction(newTxn)
            .then(async (response: TransactionResponse) => {
              setAttemptingTxn(false);
              setTxPending(true);
              const summary = mintInfo.noLiquidity
                ? `Create pool and add ${baseCurrency?.symbol}/${quoteCurrency?.symbol} liquidity`
                : `Add ${baseCurrency?.symbol}/${quoteCurrency?.symbol} liquidity`;
              addTransaction(response, {
                summary,
              });

              handleAddLiquidity();
              dispatch(setAddLiquidityTxHash({ txHash: response.hash }));

              try {
                const receipt = await response.wait();
                finalizedTransaction(receipt, {
                  summary,
                });
                setTxPending(false);
              } catch (error) {
                setTxPending(false);
                setAddLiquidityErrorMessage('Error in Tx');
              }
            });
        })
        .catch((error) => {
          console.error('Failed to send transaction', error);
          // we only care if the error is something _other_ than the user rejected the tx
          setRejected && setRejected(true);
          setAddLiquidityErrorMessage('Error in Tx');
          if (error?.code !== 4001) {
            console.error(error);
          }
        });
    } else {
      return;
    }
  }

  const handlePriceFormat = useCallback((priceFormat: PriceFormats) => {
    setPriceFormat(priceFormat);
  }, []);

  const initialUSDPrices = useInitialUSDPrices();
  const usdPriceA = useUSDCPrice(baseCurrency ?? undefined);
  const usdPriceB = useUSDCPrice(quoteCurrency ?? undefined);

  const hidePriceFormatter = useMemo(() => {
    return Boolean(
      !initialUSDPrices.CURRENCY_A &&
        !initialUSDPrices.CURRENCY_B &&
        !usdPriceA &&
        !usdPriceB,
    );
  }, [mintInfo, usdPriceA, usdPriceB, initialUSDPrices]);

  const {
    [Bound.LOWER]: priceLower,
    [Bound.UPPER]: priceUpper,
  } = useMemo(() => {
    return mintInfo.pricesAtTicks;
  }, [mintInfo]);

  const isUSD = useMemo(() => {
    return priceFormat === PriceFormats.USD;
  }, []);

  const currentPriceInUSDA = useUSDCValue(
    tryParseAmount(
      mintInfo.price
        ? mintInfo.invertPrice
          ? Number(mintInfo.price.invert().toSignificant(5)).toFixed(5)
          : Number(mintInfo.price.toSignificant(5)).toFixed(5)
        : undefined,
      quoteCurrency,
    ),
    true,
  );

  const currentPriceInUSDB = useUSDCValue(
    tryParseAmount(
      mintInfo.price
        ? mintInfo.invertPrice
          ? Number(mintInfo.price.invert().toSignificant(5)).toFixed(5)
          : Number(mintInfo.price.toSignificant(5)).toFixed(5)
        : undefined,
      baseCurrency,
    ),
    true,
  );

  const currentPrice = useMemo(() => {
    if (!mintInfo.price) return;

    const isInitialInUSD = Boolean(
      initialUSDPrices.CURRENCY_A && initialUSDPrices.CURRENCY_B,
    );

    let _price;

    if (!isUSD) {
      _price =
        isUSD && currentPriceInUSDA
          ? parseFloat(currentPriceInUSDA?.toSignificant(5))
          : mintInfo.invertPrice
          ? parseFloat(mintInfo.price.invert().toSignificant(5))
          : parseFloat(mintInfo.price.toSignificant(5));
    } else {
      if (isInitialInUSD) {
        _price = parseFloat(initialUSDPrices.CURRENCY_A);
      } else if (currentPriceInUSDA) {
        _price = parseFloat(currentPriceInUSDA.toSignificant(5));
      } else if (currentPriceInUSDB) {
        _price = parseFloat(currentPriceInUSDB.toSignificant(5));
      }
    }

    if (Number(_price) <= 0.0001) {
      return `< ${
        isUSD && (currentPriceInUSDA || isInitialInUSD) ? '$ ' : ''
      }0.0001`;
    } else {
      return `${
        isUSD && (currentPriceInUSDA || isInitialInUSD) ? '$ ' : ''
      }${_price}`;
    }
  }, [mintInfo.price, isUSD, initialUSDPrices, currentPriceInUSDA]);

  const modalHeader = () => {
    return (
      <Box>
        <Box mt={3} className='flex justify-between items-center'>
          <Box className='flex items-center'>
            <Box className='flex' mr={1}>
              <DoubleCurrencyLogo
                currency0={baseCurrency}
                currency1={quoteCurrency}
                size={48}
              />
            </Box>
            <h4>
              {baseCurrency?.symbol}-{quoteCurrency?.symbol}
            </h4>
          </Box>
          <RangeBadge
            removed={false}
            withTooltip={false}
            inRange={!mintInfo.outOfRange}
          />
        </Box>
        <Box
          mt='20px'
          padding='20px 16px'
          borderRadius='10px'
          className='bg-secondary1'
        >
          <Box className='flex justify-between'>
            <Box className='flex items-center'>
              <Box className='flex' mr='6px'>
                <CurrencyLogo currency={baseCurrency} size='24px' />
              </Box>
              <p>{baseCurrency?.symbol}</p>
            </Box>
            <p>{mintInfo.parsedAmounts[Field.CURRENCY_A]?.toSignificant()}</p>
          </Box>
          <Box mt={2} className='flex justify-between'>
            <Box className='flex items-center'>
              <Box className='flex' mr='6px'>
                <CurrencyLogo currency={quoteCurrency} size='24px' />
              </Box>
              <p>{quoteCurrency?.symbol}</p>
            </Box>
            <p>{mintInfo.parsedAmounts[Field.CURRENCY_B]?.toSignificant()}</p>
          </Box>
        </Box>
        <Box mt={3}>
          <Box className='flex justify-between items-center'>
            <p>Selected Range</p>
            {!hidePriceFormatter && (
              <Box className='flex' ml={1}>
                <PriceFormatToggler
                  currentFormat={priceFormat}
                  handlePriceFormat={handlePriceFormat}
                />
              </Box>
            )}
          </Box>
        </Box>
        <Box width={1} mt={2} className='flex justify-between'>
          {priceLower && (
            <Box
              className='v3-supply-liquidity-price-wrapper'
              width={priceUpper ? '49%' : '100%'}
            >
              <p>Min Price</p>
              <h6>{priceLower.toSignificant()}</h6>
              <p>
                {quoteCurrency?.symbol} per {baseCurrency?.symbol}
              </p>
              <p>
                Your position will be 100% Composed of {baseCurrency?.symbol} at
                this price
              </p>
            </Box>
          )}
          {priceUpper && (
            <Box
              className='v3-supply-liquidity-price-wrapper'
              width={priceLower ? '49%' : '100%'}
            >
              <p>Min Price</p>
              <h6>{priceUpper.toSignificant()}</h6>
              <p>
                {quoteCurrency?.symbol} per {baseCurrency?.symbol}
              </p>
              <p>
                Your position will be 100% Composed of {quoteCurrency?.symbol}{' '}
                at this price
              </p>
            </Box>
          )}
        </Box>
        {currentPrice && (
          <Box mt={2} className='v3-supply-liquidity-price-wrapper'>
            <p>Current Price</p>
            <h6>{currentPrice}</h6>
            <p>
              {quoteCurrency?.symbol} per {baseCurrency?.symbol}
            </p>
          </Box>
        )}
        <Box mt={2}>
          <Button className='v3-supply-liquidity-button' onClick={onAdd}>
            Confirm
          </Button>
        </Box>
      </Box>
    );
  };

  return (
    <>
      {showConfirm && (
        <TransactionConfirmationModal
          isOpen={showConfirm}
          onDismiss={handleDismissConfirmation}
          attemptingTxn={attemptingTxn}
          hash={txHash}
          content={() =>
            addLiquidityErrorMessage ? (
              <TransactionErrorContent
                onDismiss={handleDismissConfirmation}
                message={addLiquidityErrorMessage}
              />
            ) : (
              <ConfirmationModalContent
                title={'Supplying Liquidity'}
                onDismiss={handleDismissConfirmation}
                content={modalHeader}
              />
            )
          }
          pendingText='Loading...'
          modalContent={
            txPending
              ? 'Submitted Adding Liquidity'
              : 'Liquidity Added successfully'
          }
        />
      )}
      <Button
        className='v3-supply-liquidity-button'
        disabled={!isReady}
        onClick={onAddLiquidity}
      >
        {title}
      </Button>
    </>
  );
}