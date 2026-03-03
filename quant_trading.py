#!/usr/bin/env python3
"""
量化交易系统 - 完整版
500元本金短线策略
"""

import pandas as pd
import numpy as np
import akshare as ak
import argparse
import json
from datetime import datetime, timedelta

# ==================== 配置 ====================
INITIAL_CAPITAL = 500  # 初始资金500元
MAX_POSITION_PER_STOCK = 100  # 单只股票最大仓位100元
MAX_POSITIONS = 3  # 最大持仓数量
STOP_LOSS_PCT = -0.03  # 止损线 -3%
TAKE_PROFIT_PCT = 0.05  # 止盈线 +5%
MAX_DAILY_LOSS = 15  # 单日最大亏损15元
MAX_PRICE = 10  # 股价上限10元
MIN_AMOUNT = 100000000  # 最小成交额1亿
RSI_OVERSOLD = 30  # RSI超卖阈值
RSI_OVERBOUGHT = 70  # RSI超买阈值
MA_SHORT = 5  # 短期均线
MA_LONG = 20  # 长期均线
LOG_FILE = "trading_log.txt"

# ==================== 数据获取 ====================
class DataFetcher:
    """A股数据获取器"""
    
    def __init__(self):
        self.source = "akshare"
    
    def get_realtime_data(self):
        """获取实时行情"""
        try:
            df = ak.stock_zh_a_spot_em()
            df = df.rename(columns={
                '代码': 'code',
                '名称': 'name',
                '最新价': 'price',
                '涨跌幅': 'change_pct',
                '成交量': 'volume',
                '成交额': 'amount',
                '换手率': 'turnover'
            })
            return df
        except Exception as e:
            print(f"获取实时数据失败: {e}")
            return pd.DataFrame()
    
    def get_stock_data(self, symbol, days=30):
        """获取单只股票历史数据"""
        try:
            df = ak.stock_zh_a_hist(
                symbol=symbol, 
                period="daily",
                start_date=(datetime.now() - timedelta(days=days)).strftime("%Y%m%d"),
                end_date=datetime.now().strftime("%Y%m%d"),
                adjust="qfq"
            )
            return df
        except Exception as e:
            print(f"获取{symbol}数据失败: {e}")
            return pd.DataFrame()
    
    def calculate_ma(self, df, window):
        """计算移动平均线"""
        return df['收盘'].rolling(window=window).mean()
    
    def calculate_rsi(self, df, window=14):
        """计算RSI"""
        delta = df['收盘'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

# ==================== 策略 ====================
class TradingStrategy:
    """短线交易策略"""
    
    def filter_stocks(self, df):
        """筛选符合条件的股票"""
        filtered = df[
            (df['price'] > 0) & 
            (df['price'] <= MAX_PRICE) &
            (df['amount'] >= MIN_AMOUNT)
        ].copy()
        return filtered
    
    def calculate_signals(self, df, fetcher):
        """计算交易信号"""
        signals = []
        
        for _, row in df.iterrows():
            symbol = row['code']
            
            # 获取历史数据
            hist_data = fetcher.get_stock_data(symbol, days=30)
            if len(hist_data) < 20:
                continue
            
            # 计算技术指标
            hist_data['MA5'] = fetcher.calculate_ma(hist_data, MA_SHORT)
            hist_data['MA20'] = fetcher.calculate_ma(hist_data, MA_LONG)
            hist_data['RSI'] = fetcher.calculate_rsi(hist_data)
            
            latest = hist_data.iloc[-1]
            prev = hist_data.iloc[-2] if len(hist_data) > 1 else latest
            
            # 信号1: 超跌反弹
            rsi_signal = latest['RSI'] < RSI_OVERSOLD and latest['收盘'] > prev['收盘']
            
            # 信号2: 均线金叉
            ma_signal = latest['MA5'] > latest['MA20'] and prev['MA5'] <= prev['MA20']
            
            # 信号3: 放量上涨
            volume_signal = latest['成交量'] > hist_data['成交量'].mean() * 1.5
            
            # 综合评分
            score = 0
            signal_types = []
            if rsi_signal: 
                score += 40
                signal_types.append("超跌反弹")
            if ma_signal: 
                score += 30
                signal_types.append("均线金叉")
            if volume_signal: 
                score += 30
                signal_types.append("放量上涨")
            
            if score >= 40:
                max_shares = int(MAX_POSITION_PER_STOCK / row['price'] / 100) * 100
                signals.append({
                    'code': symbol,
                    'name': row['name'],
                    'price': row['price'],
                    'change_pct': row['change_pct'],
                    'rsi': latest['RSI'],
                    'score': score,
                    'signal_type': "+".join(signal_types),
                    'suggest_shares': max_shares,
                    'suggest_cost': max_shares * row['price']
                })
        
        signals_df = pd.DataFrame(signals)
        if len(signals_df) > 0:
            signals_df = signals_df.sort_values('score', ascending=False)
        return signals_df

# ==================== 主程序 ====================
class QuantTrader:
    """量化交易系统"""
    
    def __init__(self):
        self.fetcher = DataFetcher()
        self.strategy = TradingStrategy()
        self.capital = INITIAL_CAPITAL
    
    def scan_stocks(self):
        """扫描选股"""
        print(f"\n{'='*60}")
        print(f"📊 量化选股系统 - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        print(f"💰 初始资金: {self.capital}元 | 止损线: {STOP_LOSS_PCT*100}% | 止盈线: {TAKE_PROFIT_PCT*100}%")
        print(f"{'='*60}\n")
        
        # 获取实时数据
        print("⏳ 正在获取实时行情...")
        df = self.fetcher.get_realtime_data()
        if len(df) == 0:
            print("❌ 获取数据失败")
            return
        print(f"✅ 获取到 {len(df)} 只股票")
        
        # 筛选
        print(f"\n⏳ 正在筛选 (股价≤{MAX_PRICE}元, 成交额≥{MIN_AMOUNT/1e8:.0f}亿)...")
        filtered = self.strategy.filter_stocks(df)
        print(f"✅ 筛选后: {len(filtered)}只")
        
        # 计算信号
        print("\n⏳ 正在计算技术指标...")
        signals = self.strategy.calculate_signals(filtered, self.fetcher)
        
        if len(signals) == 0:
            print("\n⚠️ 今日无符合条件的股票")
            return
        
        # 输出结果
        print(f"\n{'='*60}")
        print(f"🎯 今日推荐标的 (Top 5):")
        print(f"{'='*60}")
        
        for i, row in signals.head(5).iterrows():
            print(f"\n【{row['name']} - {row['code']}】")
            print(f"  现价: ¥{row['price']:.2f}  涨跌: {row['change_pct']:.2f}%")
            print(f"  RSI: {row['rsi']:.1f}  综合评分: {row['score']}")
            print(f"  信号类型: {row['signal_type']}")
            print(f"  💡 建议买入: {row['suggest_shares']}股, 约¥{row['suggest_cost']:.0f}")
        
        print(f"\n{'='*60}")
        print("⚠️ 风险提示:")
        print("  1. 以上仅为信号建议，不构成投资建议")
        print("  2. 请严格设置止损线 -3%，止盈线 +5%")
        print("  3. 单只股票仓位不超过100元")
        print("  4. 模拟盘验证3个月后再考虑实盘")
        print(f"{'='*60}")
        
        # 保存到文件
        signals.head(10).to_csv(
            f"signals_{datetime.now().strftime('%Y%m%d')}.csv",
            index=False, encoding='utf-8-sig'
        )
        print(f"\n💾 已保存到: signals_{datetime.now().strftime('%Y%m%d')}.csv")
    
    def log_trade(self, action, code, name, price, shares, reason=""):
        """记录交易"""
        trade = {
            'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'action': action,
            'code': code,
            'name': name,
            'price': price,
            'shares': shares,
            'amount': price * shares,
            'reason': reason
        }
        
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"{trade['time']},{action},{code},{name},{price},{shares},{trade['amount']},{reason}\n")
        
        print(f"\n📝 交易记录: {action} {name} {shares}股 @ ¥{price}")
    
    def show_help(self):
        """显示帮助"""
        print("""
量化交易系统 - 使用说明

1. 选股扫描 (每日开盘前运行):
   python quant_trading.py --mode scan

2. 记录买入 (买入后记录):
   python quant_trading.py --mode buy --code 000001 --name 平安银行 --price 10.5 --shares 100

3. 记录卖出 (卖出后记录):
   python quant_trading.py --mode sell --code 000001 --name 平安银行 --price 11.0 --shares 100 --reason 止盈

4. 查看持仓:
   python quant_trading.py --mode positions

5. 生成报告:
   python quant_trading.py --mode report

配置文件:
   直接编辑代码中的配置部分（INITIAL_CAPITAL等参数）

数据文件:
   signals_YYYYMMDD.csv - 每日选股结果
   trading_log.txt - 交易记录
        """)

def main():
    parser = argparse.ArgumentParser(description='量化交易系统')
    parser.add_argument('--mode', choices=['scan', 'buy', 'sell', 'positions', 'report', 'help'],
                       default='scan', help='运行模式')
    parser.add_argument('--code', help='股票代码')
    parser.add_argument('--name', help='股票名称')
    parser.add_argument('--price', type=float, help='价格')
    parser.add_argument('--shares', type=int, help='股数')
    parser.add_argument('--reason', default='', help='原因')
    
    args = parser.parse_args()
    
    trader = QuantTrader()
    
    if args.mode == 'scan':
        trader.scan_stocks()
    elif args.mode == 'buy':
        if args.code and args.name and args.price and args.shares:
            trader.log_trade('buy', args.code, args.name, args.price, args.shares, args.reason)
        else:
            print("参数不足，需要: --code --name --price --shares")
    elif args.mode == 'sell':
        if args.code and args.name and args.price and args.shares:
            trader.log_trade('sell', args.code, args.name, args.price, args.shares, args.reason)
        else:
            print("参数不足，需要: --code --name --price --shares")
    elif args.mode == 'positions':
        print("持仓功能开发中...")
    elif args.mode == 'report':
        print("报告功能开发中...")
    elif args.mode == 'help':
        trader.show_help()

if __name__ == "__main__":
    main()
