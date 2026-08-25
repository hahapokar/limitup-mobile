#!/usr/bin/env python3
"""
Root entry point for A-Share Limit-Up Quant Trading System.
"""
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from quant_system.app import main

if __name__ == "__main__":
    main()
