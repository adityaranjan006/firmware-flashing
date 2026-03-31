

to flash bootloader use below command
STM32_Programmer_CLI -c port=SWD sn=37FF71064E57343624EB1243 -e all -w BL_SSB.hex -v

to flash main application binary use below command
STM32_Programmer_CLI -c port=SWD sn=37FF71064E57343624EB1243 -w SensorBoard_A_1_0_0.hex -v -rst
