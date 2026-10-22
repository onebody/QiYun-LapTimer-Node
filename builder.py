import os

Import("env")  # noqa: F821

# lib/ 下的模块源文件是平铺的，而 PlatformIO 只把 lib/<子目录> 识别为项目库，
# 因此需手工把 lib/ 根接入头文件搜索路径与固件编译。
lib_dir = os.path.join(env.subst("$PROJECT_DIR"), "lib")

env.Append(CPPPATH=[lib_dir])
env.BuildSources(os.path.join(env.subst("$BUILD_DIR"), "lib_flat"), lib_dir)
