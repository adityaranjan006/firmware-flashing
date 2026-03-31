#!/bin/bash

rm -rf ./csv ./bin ./master_conf_tmp.csv nvs_conf_tmp.csv

python3 mfg_gen.py generate --fileid id nvs_conf.csv master_conf.csv hub 0x10000

rm master_conf_tmp.csv nvs_conf_tmp.csv