#pragma once

#include <memory>

class MeApplicationPrivate;

class MeApplication {
  std::unique_ptr<MeApplicationPrivate> d_ptr;

public:
  MeApplication(int argc, char** argv);
  ~MeApplication();

  MeApplication(const MeApplication&) = delete;
  MeApplication& operator=(const MeApplication&) = delete;

  static MeApplication* instance();

  bool exec();

private:
  static MeApplication* s_instance;
};